// src/agent/loop.js
// ---------------------------------------------------------------------------
// The KERYX agent loop. Given a question:
//   1. retrieve candidate sources from the corpus
//   2. decide BUY/SKIP per candidate, on a budget (real economic judgment)
//   3. fetch the bought sources — paid via x402 ONLY when settleMode is
//      'x402'; otherwise read the local copy for free, since escrow/direct
//      will pay for it later, at step 5, based on confirmed citation
//   4. ground an answer + assign each cited source a contribution %
//   5. settle a payout to each cited writer — skipped entirely for 'x402',
//      since that mode already paid at step 3, at the moment of read
//
// The three settle modes are mutually exclusive by design, so a work is
// never paid for twice in the same answer:
//   'escrow' — pays only sources that end up cited, after the answer is
//              written. Funds accumulate in the writer's on-chain balance.
//   'direct' — pays only sources that end up cited, after the answer is
//              written. Reader signs a direct wallet-to-wallet transfer
//              per writer, same mechanism as a manual Buy.
//   'x402'   — pays the moment a source is bought and read, whether or not
//              it ends up quoted in the final answer. Real x402 challenge,
//              real Circle Gateway settlement, to that work's real author.
//
// onEvent(type, payload) streams progress so the UI can render it live.
// ---------------------------------------------------------------------------
import 'dotenv/config';
import { retrieve, loadCorpus } from '../corpus/store.js';
import { decideSources, groundAnswer } from './llm.js';
import { fetchPaidSource } from '../circle/x402.js';
import { settleAnswerOnchain } from '../settle/citation.js';

const BUDGET = process.env.ANSWER_BUDGET_USDC || '0.0100';
const SETTLE_MODE = process.env.SETTLE_MODE || 'onchain'; // 'onchain' (escrow) | 'direct' | 'x402'
const noop = () => {};

/**
 * @param {string} question
 * @param {{ onEvent?: Function, reader?: string, settleMode?: 'escrow'|'direct'|'x402' }} opts
 */
export async function ask(question, { onEvent = noop, reader = null, settleMode = null } = {}) {
  const rawMode = settleMode || SETTLE_MODE;
  const mode = rawMode === 'onchain' ? 'escrow' : rawMode; // normalize legacy env value
  const answerId = `ans_${Date.now()}`;
  const byId = Object.fromEntries(loadCorpus().map((w) => [w.id, w]));

  // 1) retrieve
  const candidates = retrieve(question, Number(process.env.RETRIEVE_K || 5))
    .map((w) => ({ id: w.id, title: w.title, handle: w.handle, price: w.price, snippet: w.snippet, relevance: w.relevance }));
  onEvent('retrieved', { candidates });

  // 2) decide buy/skip on budget — then stream each decision with a running
  //    budget ticker and, where relevant, an explicit tradeoff explanation.
  const decisions = await decideSources({ question, candidates, budget: BUDGET });

  const bought = decisions.filter((d) => d.decision === 'BUY');
  const cheapestBoughtPriceAtOrAbove = (relevanceFloor) => {
    const near = bought.filter((b) => (byId[b.id]?.price ?? 0) < Infinity && b.relevance >= relevanceFloor - 0.15);
    if (near.length === 0) return null;
    return near.reduce((min, b) => ((byId[b.id]?.price ?? Infinity) < (byId[min.id]?.price ?? Infinity) ? b : min));
  };

  let budgetRemaining = Number(BUDGET);
  for (const d of decisions) {
    const price = Number(byId[d.id]?.price ?? 0);
    let tradeoffNote = null;

    if (d.decision === 'BUY') {
      budgetRemaining = Math.max(0, budgetRemaining - price);
    } else {
      const cheaperAlt = cheapestBoughtPriceAtOrAbove(d.relevance);
      if (cheaperAlt && (byId[cheaperAlt.id]?.price ?? Infinity) < price) {
        tradeoffNote = `Passed on this despite ${d.relevance >= cheaperAlt.relevance ? 'comparable or higher' : 'nearby'} relevance — "${cheaperAlt.id}" covered similar ground for $${Number(byId[cheaperAlt.id].price).toFixed(4)} instead of $${price.toFixed(4)}.`;
      }
    }

    onEvent('decision', { ...d, price, budgetRemaining, tradeoffNote });
  }

  const buyIds = bought.map((d) => d.id);

  // 3) fetch bought sources. Only actually PAY via x402 here when mode is
  //    'x402' — for 'escrow'/'direct', read the local copy for free, since
  //    payment for those two happens later, at step 5, and only for
  //    whatever ends up genuinely cited.
  const sources = [];
  const x402Paid = []; // workIds actually paid for at read-time, this answer
  for (const id of buyIds) {
    const w = byId[id];
    let text = (w.chunks || []).join('\n');
    let tx = null;

    if (mode === 'x402' && process.env.PUBLISHER_BASE_URL) {
      try {
        const r = await fetchPaidSource(`${process.env.PUBLISHER_BASE_URL}/content/${id}`);
        text = r.text; tx = r.tx;
        x402Paid.push(id);
        onEvent('settled', {
          id,
          mode: 'x402',
          amount: w.price,
          contributionPct: null, // not known yet — this pays on read, not on citation
          receiptUrl: null,
        });
      } catch (e) {
        onEvent('warn', { id, message: `x402 payment failed, reading local copy free: ${e.message}` });
      }
    }

    onEvent('purchased', { id, tollTx: tx, price: w.price });
    sources.push({ id, title: w.title, handle: w.handle, text });
  }

  // 4) ground the answer + contribution weights
  const grounded = await groundAnswer({ question, sources });
  onEvent('answer', { answer: grounded.answer });
  const allCitations = (grounded.citations || []).filter((c) => byId[c.id]);

  // A citation can exist in the content index (so the agent could read and
  // quote it) without ever being registered on-chain — e.g. a Medium import
  // with no wallet on file. Settling payment for those would either throw
  // ("not registered on-chain") or silently be wrong. Split them out here so
  // every settlement path below only ever touches genuinely payable work,
  // and one unpayable citation can never take down the whole answer.
  const citations = allCitations.filter((c) => {
    const w = byId[c.id];
    return Array.isArray(w?.recipients) ? w.recipients.length > 0 : Boolean(w?.wallet);
  });
  const unpayableCitations = allCitations.filter((c) => !citations.includes(c));
  for (const c of unpayableCitations) {
    onEvent('unpaid', {
      id: c.id,
      reason: 'cited, but no wallet on file — not yet registered on-chain',
    });
  }

  // 5) settle payouts — skipped entirely for 'x402', already paid at step 3.
  let settlement;
  if (mode === 'x402') {
    settlement = { mode: 'x402', paidAtReadTime: x402Paid };
  } else if (mode === 'direct') {
    settlement = {
      mode: 'direct',
      pending: citations.map((c) => ({
        id: c.id,
        wallet: byId[c.id]?.wallet,
        amount: byId[c.id]?.price,
        contributionPct: c.contributionPct,
      })),
    };
    // No 'settled' events here — the frontend emits its own as each direct
    // transfer is individually signed and confirmed.
  } else {
    if (citations.length === 0) {
      // Every cited source turned out to be content-only, no wallet on
      // file — nothing to settle, but the answer itself is still valid.
      settlement = { mode: 'onchain', results: [] };
    } else {
      if (!reader) {
        throw new Error('settleMode=escrow requires a reader address — none was provided to ask()');
      }
      settlement = await settleAnswerOnchain({
        reader,
        citations: citations.map((c) => ({ workId: c.id, contributionPct: c.contributionPct })),
      });
      for (const r of settlement.results) {
        onEvent('settled', {
          id: r.workId,
          mode: 'onchain',
          amount: r.amount,
          contributionPct: r.contributionPct,
          receiptUrl: r.receiptUrl,
        });
      }
    }
  }

  const result = { answerId, answer: grounded.answer, citations, settlement };
  onEvent('complete', {
    answerId,
    paid: mode === 'x402' ? x402Paid.length : mode === 'direct' ? 0 : citations.length,
    settleMode: mode,
    pending: settlement.pending || null,
  });
  return result;
}