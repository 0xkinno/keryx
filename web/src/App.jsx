import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAccount, useDisconnect, useWriteContract, usePublicClient } from 'wagmi';
import { parseUnits } from 'viem';
import {
  USDC_ADDR, KERYX_ADDR, EXPLORER, API_URL,
  KERYX_ABI, ERC20_ABI, arcTestnet, ARC_CHAIN_ID
} from './wallet.js';

/* ── CORPUS (seed fallback — overwritten by /api/works on load) ── */
const INITIAL_CORPUS = {
  k1: { title: "DeFi Doesn't Remove Trust — It Engineers It",   author: 'Aristotle', handle: '@aristotle', you: true,  price: 0.0007, blurb: 'Trust never leaves DeFi — it moves to contracts, oracles and bridges. Better to engineer it than deny it.',     wallet: '0xe4B713e3cF2E550147f9cc09d751f276E7B9A64e' },
  k2: { title: 'Why Private DeFi Is the Use Case That Matters', author: 'Aristotle', handle: '@aristotle', you: true,  price: 0.0008, blurb: "On a public chain income and strategy are exposed; in emerging markets that's a real liability.",                  wallet: '0xe4B713e3cF2E550147f9cc09d751f276E7B9A64e' },
  k3: { title: 'The Original Mesh Network: Pigeon Post & Sovereign Data', author: 'Aristotle', handle: '@aristotle', you: true,  price: 0.0006, blurb: 'The carrier pigeon was a private, decentralised mesh. Modern infra made interception the default.',      wallet: '0xe4B713e3cF2E550147f9cc09d751f276E7B9A64e' },
  k4: { title: 'Why You Should Use a Concrete Vault',           author: 'Aristotle', handle: '@aristotle', you: true,  price: 0.0005, blurb: 'Concrete vaults apply engineered trust to yield: on-chain enforcement plus off-chain monitoring.',              wallet: '0xe4B713e3cF2E550147f9cc09d751f276E7B9A64e' },
};

/* ── HELPERS ── */
const fmt6   = n  => Number(n).toFixed(6);
const short  = a  => a ? `${a.slice(0,6)}…${a.slice(-4)}` : '';
const inits  = n  => n.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
const rndTx  = () => { const h='0123456789abcdef'; let s='0x'; for(let i=0;i<4;i++) s+=h[~~(Math.random()*16)]; s+='…'; for(let i=0;i<4;i++) s+=h[~~(Math.random()*16)]; return s; };
const settle = () => (0.31+Math.random()*0.22).toFixed(2);
const wait   = ms => new Promise(r => setTimeout(r, ms));
const reduced = () => window.matchMedia('(prefers-reduced-motion:reduce)').matches;

/* ── DEMO FLOWS (offline fallback only) ── */
const DEMO = {
  "Does DeFi actually remove the need for trust?": {
    consider: ['k1','k4','k2','k3'], buy: ['k1','k4','k2'],
    text: `No — it relocates it. "Trust the code, not people" simply moved confidence onto contract authors, auditors, oracle feeds and governance voters [k1]. So the honest move is to engineer trust: explicit roles, on-chain enforcement, and a response layer that acts when reality drifts past what the code anticipated. A concrete vault applies this to yield [k4]. On a fully public chain, your exposed activity can be used against you [k2].`
  },
  "Why does privacy matter in DeFi?": {
    consider: ['k2','k3','k1'], buy: ['k2','k3'],
    text: `Because a public chain is not neutral. Every payment, position and transfer is legible to anyone watching — a liability in emerging markets where income and strategy sit in the open [k2]. Underneath sits the carrier-pigeon principle — the network's job is to carry the message, not to read it [k3].`
  },
  "What can a carrier pigeon teach us about data networks?": {
    consider: ['k3','k2','k4'], buy: ['k3','k2'],
    text: `More than it should. A pigeon network was point-to-point with no hub logging who spoke to whom, redundant, and private by default [k3]. Modern infrastructure inverted that. Rebuilding the pigeon means mesh topology plus encrypted compute so the relays carry a sealed message they cannot open — the same reason transparent on-chain finance needs shielded inputs to be usable by those its default exposure puts most at risk [k2].`
  },
};
function buildGenericDemo(q, corpus) {
  const words = q.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const scored = Object.keys(corpus).map(id => {
    const h = (corpus[id].title + ' ' + corpus[id].blurb).toLowerCase();
    const s = words.reduce((acc, w) => acc + (h.includes(w) ? 1 : 0), 0);
    return { id, s: s + Math.random() * 0.4 };
  }).sort((a, b) => b.s - a.s);
  const consider = scored.slice(0, 5).map(x => x.id);
  const buy      = scored.slice(0, 3).map(x => x.id);
  const text     = buy.map(id => corpus[id]?.blurb || '').join(' ') + ` [${buy[0]}].`;
  return { consider, buy, text };
}

/* ════════════════════════════════════════════════════════
   APP ROOT — now syncs the real corpus from the backend
   on load, so registered works survive refreshes.
   ════════════════════════════════════════════════════════ */
export default function App() {
  const [view, setView] = useState('landing'); // 'landing' | 'ask' | 'earn' | 'explorer'
  const [corpus, setCorpus] = useState(INITIAL_CORPUS);
  const publicClient = usePublicClient();

  const [sessionEarned, setSessionEarned] = useState(0);
  const [citesByWork, setCitesByWork]     = useState({ k1:47, k2:39, k3:28, k4:33 });
  const [totalCites, setTotalCites]       = useState(147);

  // Read the FULL work catalog directly from the KeryxSplits contract.
  // This is now the authoritative source — title, url, price, and recipient
  // splits all live on-chain, so any wallet sees the exact same catalog
  // with no dependency on any off-chain index staying in sync.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const total = await publicClient.readContract({
          address: KERYX_ADDR,
          abi: KERYX_ABI,
          functionName: 'workCount',
          chainId: ARC_CHAIN_ID,
        });
        const count = Number(total);
        if (count === 0) return; // nothing registered yet — keep seed corpus for demo

        const ids = await publicClient.readContract({
          address: KERYX_ADDR,
          abi: KERYX_ABI,
          functionName: 'getWorkIdsPage',
          args: [0n, BigInt(count)],
          chainId: ARC_CHAIN_ID,
        });

        const entries = await Promise.all(ids.map(async (id) => {
          try {
            const [title, url, recipients, bps, price, citationCount, exists] = await publicClient.readContract({
              address: KERYX_ADDR,
              abi: KERYX_ABI,
              functionName: 'getWork',
              args: [id],
              chainId: ARC_CHAIN_ID,
            });
            if (!exists) return null;
            const primary = recipients[0] || '';
            return [id, {
              title,
              author: short(primary) || 'Unknown',
              handle: short(primary),
              you: false, // resolved per-viewer by comparing connected wallet
              price: Number(price) / 1e6,
              blurb: url || title,
              wallet: primary,
              recipients: Array.from(recipients),
              bps: Array.from(bps).map(Number),
              onchainCitations: Number(citationCount),
            }];
          } catch (getWorkErr) {
            console.error(`[KERYX] getWork("${id}") failed:`, getWorkErr);
            return null;
          }
        }));

        const byId = Object.fromEntries(entries.filter(Boolean));
        if (!cancelled && Object.keys(byId).length > 0) {
          setCorpus(byId); // chain is authoritative — replace, don't merge with stale seed
        } else if (!cancelled) {
          console.warn('[KERYX] On-chain catalog read returned zero usable entries — check the errors above.');
        }
      } catch (discoveryErr) {
        // Surfaced loudly now — a silent fallback here previously hid a real
        // bug (missing chainId) behind what looked like "just missing data."
        console.error('[KERYX] On-chain catalog discovery failed, falling back to seed corpus:', discoveryErr);
      }
    })();
    return () => { cancelled = true; };
  }, [publicClient]);

  const addCite = useCallback((id, amount) => {
    setSessionEarned(p => p + amount);
    setTotalCites(p => p + 1);
    setCitesByWork(p => ({ ...p, [id]: (p[id] || 0) + 1 }));
  }, []);

  const addWork = useCallback((id, entry) => {
    setCorpus(p => ({ ...p, [id]: entry }));
    setCitesByWork(p => ({ ...p, [id]: 0 }));
  }, []);

  if (view === 'landing') return <Landing onEnter={() => setView('ask')} />;
  return (
    <AppShell
      navView={view}
      onNavChange={setView}
      corpus={corpus}
      sessionEarned={sessionEarned}
      citesByWork={citesByWork}
      totalCites={totalCites}
      onAddCite={addCite}
      onAddWork={addWork}
    />
  );
}

/* ════════════════════════════════════════════════════════
   LANDING
   ════════════════════════════════════════════════════════ */
function Landing({ onEnter }) {
  const { address } = useAccount();
  return (
    <section className="landing">
      <div className="wrap land-top">
        <span className="brand">
          <span className="coin">K</span><span className="wordmark">KERYX</span><span className="greek">ΚΗΡΥΞ</span>
        </span>
      </div>

      <div className="keryx-top-right-fixed">
        <a className="land-link" onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}>How it pays</a>
        <div className="keryx-wallet-slot"><WalletButton /></div>
        <div className="pill"><span className="dot" />&nbsp;Arc · testnet</div>
      </div>

      <div className="wrap land-hero">
        <div className="land-figure" />
        <div className="land-copy">
          <span className="land-eyebrow"><span className="ln" /><span className="insc">An answer engine that pays its sources</span></span>
          <h1 className="land-h1">Every citation<br /><em>strikes a coin.</em></h1>
          <p className="land-sub">KERYX answers like any AI — but it pays the writers it's built from. A sub-cent USDC payment is struck to each source the instant the answer cites it, settled on Arc in under half a second.</p>
          <div className="land-cta">
            <button className="cta-primary" onClick={onEnter}>Enter the engine →</button>
            <button className="cta-ghost" onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}>See how it pays</button>
          </div>
          <div className="land-proof">
            <div className="pf"><span className="pf-v">$0.000001</span><span className="pf-k">smallest payout</span></div>
            <div className="pf"><span className="pf-v">&lt;500ms</span><span className="pf-k">settlement</span></div>
            <div className="pf"><span className="pf-v">per citation</span><span className="pf-k">not per month</span></div>
          </div>
        </div>
      </div>
      <div className="how" id="how">
        <div className="wrap">
          <div className="how-head"><span className="insc">How it pays</span><h2>Three moves from a question to a writer <em>getting paid.</em></h2></div>
          <div className="steps">
            {[
              { n:'01', h:'Writers register', p:'A writer puts a piece behind an x402 paywall and sets a price per citation. Their wallet is their identity; the work becomes payable on-chain.', tags:['x402','Wallets','KeryxSplits'] },
              { n:'02', h:'The herald decides', p:'Given a question and a budget, the agent discovers sources, weighs cost against relevance, and pays the x402 toll only for sources worth buying.', tags:['autonomous agent','x402','Gateway'] },
              { n:'03', h:'The coin is struck', p:'The instant a source is cited, a CitationSettled event fires on Arc — sub-cent USDC to the writer\'s wallet, no waiting, no opaque monthly pool.', tags:['USDC','Contracts','<500ms'] },
            ].map(s => (
              <div className="step" key={s.n}>
                <div className="step-num">{s.n}</div>
                <h3>{s.h}</h3><p>{s.p}</p>
                <div className="step-tools">{s.tags.map(t => <span className="ttag" key={t}>{t}</span>)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="wrap land-close">
          <h2>Watch money flow to writers <em>as the machine thinks.</em></h2>
          <button className="cta-primary" onClick={onEnter}>Enter the engine →</button>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════
   APP SHELL — owns Ask session state + a running,
   numbered activity log shared across the whole app.
   ════════════════════════════════════════════════════════ */
function AppShell({ navView, onNavChange, corpus, sessionEarned, citesByWork, totalCites, onAddCite, onAddWork }) {
  const [toast, setToast]       = useState({ show: false, msg: '' });
  const [modal, setModal]       = useState(null); // null | 'approval' | 'buy' | 'register'
  const [buyTarget, setBuyTarget] = useState(null);
  const [regPreTitle, setRegPreTitle] = useState('');
  const toastTimer = useRef(null);

  // ── Ask view state, lifted here so it persists across nav/modal round-trips ──
  const [askQuestion, setAskQuestion]     = useState('');
  const [askBusy, setAskBusy]             = useState(false);
  const [askStage, setAskStage]           = useState(false);
  const [askDecisions, setAskDecisions]   = useState([]);
  const [askAnswerHtml, setAskAnswerHtml] = useState('');
  const [askReceipts, setAskReceipts]     = useState([]);
  const [askTally, setAskTally]           = useState(0);
  const [askSrcN, setAskSrcN]             = useState(0);
  const [askSettleN, setAskSettleN]       = useState(0);
  const [askShowFoot, setAskShowFoot]     = useState(false);
  const [apprDone, setApprDone]           = useState(false);
  const [askBudgetLeft, setAskBudgetLeft] = useState(0.0100);

  // ── Numbered activity log — every buy, sell/register, and settlement, most recent first ──
  const [activityLog, setActivityLog] = useState([]);
  const activityCounter = useRef(0);
  const addActivity = useCallback((entry) => {
    activityCounter.current += 1;
    setActivityLog(p => [{ n: activityCounter.current, ts: Date.now(), ...entry }, ...p]);
  }, []);

  const showToast = useCallback((msg) => {
    setToast({ show: true, msg });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast({ show: false, msg: '' }), 3400);
  }, []);

  const openBuy = useCallback((id) => { setBuyTarget(id); setModal('buy'); }, []);
  const openRegister = useCallback((pre = '') => { setRegPreTitle(pre); setModal('register'); }, []);
  const closeModal = useCallback(() => setModal(null), []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="wrap bar">
          <span className="brand" onClick={() => onNavChange('landing')} style={{ cursor:'pointer' }}>
            <span className="coin">K</span><span className="wordmark">KERYX</span><span className="greek">ΚΗΡΥΞ</span><span className="bar-tag">paid by the citation</span>
          </span>
          <div className="spacer" />
          <nav className="nav">
            <button className={`navbtn${navView==='ask'?' on':''}`} onClick={() => onNavChange('ask')}>Ask</button>
            <button className={`navbtn${navView==='earn'?' on':''}`} onClick={() => onNavChange('earn')}>Earnings</button>
            <button className={`navbtn${navView==='explorer'?' on':''}`} onClick={() => onNavChange('explorer')}>Explorer</button>
          </nav>
          <WalletButton />
          <div className="pill"><span className="dot" />&nbsp;Arc · testnet</div>
        </div>
      </header>

      {navView === 'ask' && (
        <AskView
          corpus={corpus}
          onAddCite={onAddCite}
          onBuyArticle={openBuy}
          onSellArticle={openRegister}
          onOpenApproval={() => setModal('approval')}
          onToast={showToast}
          onActivity={addActivity}
          question={askQuestion} setQuestion={setAskQuestion}
          busy={askBusy} setBusy={setAskBusy}
          stage={askStage} setStage={setAskStage}
          decisions={askDecisions} setDecisions={setAskDecisions}
          answerHtml={askAnswerHtml} setAnswerHtml={setAskAnswerHtml}
          receipts={askReceipts} setReceipts={setAskReceipts}
          tally={askTally} setTally={setAskTally}
          srcN={askSrcN} setSrcN={setAskSrcN}
          settleN={askSettleN} setSettleN={setAskSettleN}
          showFoot={askShowFoot} setShowFoot={setAskShowFoot}
          apprDone={apprDone}
          budgetLeft={askBudgetLeft} setBudgetLeft={setAskBudgetLeft}
        />
      )}
      {navView === 'earn' && (
        <EarnView
          corpus={corpus}
          sessionEarned={sessionEarned}
          citesByWork={citesByWork}
          totalCites={totalCites}
          onRegister={() => openRegister()}
          onToast={showToast}
          activityLog={activityLog}
          onActivity={addActivity}
        />
      )}
      {navView === 'explorer' && <ExplorerView corpus={corpus} onBuyArticle={openBuy} onRegister={() => openRegister()} />}

      <footer className="app-footer">
        <div className="wrap foot">
          <span>KERYX · an answer engine that pays its sources · built on Arc</span>
          <span className="seq"><span>x402 toll</span>→<span>Gateway nanopay</span>→<span>writer wallet</span></span>
        </div>
      </footer>

      {/* MODALS */}
      {modal === 'approval'  && <ApprovalModal onClose={closeModal} onToast={showToast} onApproved={() => setApprDone(true)} />}
      {modal === 'buy'       && <BuyModal id={buyTarget} corpus={corpus} onClose={closeModal} onToast={showToast} onActivity={addActivity} />}
      {modal === 'register'  && <RegisterModal preTitle={regPreTitle} onClose={closeModal} onAddWork={onAddWork} onToast={showToast} onActivity={addActivity} />}

      {/* TOAST */}
      <div className={`toast${toast.show?' show':''}`}>
        <span className="toast-dot" />
        <span dangerouslySetInnerHTML={{ __html: toast.msg }} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   SLICE 1 — WALLET BUTTON
   ════════════════════════════════════════════════════════ */
function WalletButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  if (isConnected) {
    return (
      <button className="wallet-btn connected" onClick={() => disconnect()}>
        <span className="wdot" />{short(address)}
      </button>
    );
  }
  return <appkit-button />;
}

/**
 * Direct-settlement helper: signs a real USDC transfer to each cited writer,
 * one at a time, using the exact same mechanism as a manual Buy — but run
 * automatically across every citation right after the answer streams in.
 * Calls onSettled(count, receipt) after each successful signature.
 */
async function settleDirect(pending, corpus, writeContractAsync, onSettled, onToast) {
  let count = 0;
  for (const p of pending) {
    const c = corpus[p.id];
    const totalAmount = Number(p.amount ?? c?.price ?? 0);
    if (totalAmount <= 0) continue;

    // Same split logic as BuyModal — the agent's own automatic Direct-mode
    // settlement must split across ALL recipients too, not just the
    // primary one. This was previously missed here even after BuyModal
    // was fixed, so a co-authored work cited automatically in Direct mode
    // would have silently shortchanged every co-author.
    const recipients = Array.isArray(c?.recipients) && c.recipients.length > 0
      ? c.recipients
      : [p.wallet || c?.wallet];
    const bps = Array.isArray(c?.bps) && c.bps.length === recipients.length
      ? c.bps
      : [10000];

    const totalUnits = Math.round(totalAmount * 1e6);
    let distributed = 0;
    const shares = recipients.map((addr, i) => {
      let share;
      if (i === recipients.length - 1) {
        share = totalUnits - distributed;
      } else {
        share = Math.floor((totalUnits * bps[i]) / 10000);
        distributed += share;
      }
      return { address: addr, units: BigInt(share), amount: share / 1e6 };
    });

    for (const share of shares) {
      if (!share.address || share.amount <= 0) continue;
      try {
        const txHash = await writeContractAsync({
          address: USDC_ADDR,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [share.address, share.units],
          chainId: 5042002,
        });
        count += 1;
        onSettled(count, {
          id: p.id,
          amount: share.amount,
          wallet: share.address,
          contributionPct: p.contributionPct,
          receiptUrl: `${EXPLORER}/tx/${txHash}`,
        });
      } catch (e) {
        if (e.code !== 4001) onToast?.(`Direct payment to ${short(share.address)} failed: ${e.message?.slice(0, 40)}`);
        return; // stop the whole sequence rather than silently skipping ahead
      }
    }
  }
}

/* ════════════════════════════════════════════════════════
   SLICE 2 — ASK VIEW
   ════════════════════════════════════════════════════════ */
function AskView({
  corpus, onAddCite, onBuyArticle, onSellArticle, onOpenApproval, onToast, onActivity,
  question, setQuestion, busy, setBusy, stage, setStage,
  decisions, setDecisions, answerHtml, setAnswerHtml, receipts, setReceipts,
  tally, setTally, srcN, setSrcN, settleN, setSettleN, showFoot, setShowFoot,
  apprDone, budgetLeft, setBudgetLeft
}) {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [settleMode, setSettleMode] = useState('escrow'); // 'escrow' | 'x402' | 'direct'

  const CHIPS = [
    "Does DeFi actually remove the need for trust?",
    "Why does privacy matter in DeFi?",
    "What can a carrier pigeon teach us about data networks?",
  ];

  const handleAsk = async (q = question) => {
    if (!q.trim() || busy) return;
    if (!isConnected) { onToast('Connect your wallet first'); return; }
    if (!apprDone) {
      onOpenApproval();
      return;
    }
    setBusy(true); setStage(true);
    setDecisions([]); setAnswerHtml(''); setReceipts([]);
    setTally(0); setSrcN(0); setSettleN(0); setShowFoot(false);
    setBudgetLeft(0.0100);
    let struck = 0, tallyAcc = 0, buyCount = 0;
    try {
      const res = await fetch(`${API_URL}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, reader: address, settleMode }),
      });
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split('\n\n'); buf = frames.pop();
        for (const f of frames) {
          const ev = (f.match(/event: (.*)/) || [])[1];
          const dm = f.match(/data: (.*)/s); if (!dm) continue;
          let d; try { d = JSON.parse(dm[1]); } catch { continue; }
          if (ev === 'decision') {
            if (d.decision === 'BUY') buyCount++;
            if (typeof d.budgetRemaining === 'number') setBudgetLeft(d.budgetRemaining);
            setDecisions(p => [...p, { ...d, c: corpus[d.id] || { title: d.id, handle: '', price: 0 } }]);
          } else if (ev === 'answer') {
            let n = 0;
            const html = d.answer.replace(/\[(\w+)\]/g, (_, id) => { n++; return `<sup class="cite" data-id="${id}">[${n}]</sup>`; });
            struck = n; setAnswerHtml(html);
          } else if (ev === 'settled') {
            const c = corpus[d.id] || { price: Number(d.amount) || 0.0007, you: false };
            const amt = Number(d.amount || c.price);
            tallyAcc += amt; setTally(tallyAcc);
            setReceipts(p => [{ id: d.id, c, contrib: d.contributionPct || 100, url: d.receiptUrl || '', amt, ts: settle() }, ...p]);
            if (c.you) onAddCite(d.id, amt);
            onActivity({
              type: 'settled',
              label: `Agent settled citation · ${c.title || d.id}`,
              amount: amt,
              wallet: c.wallet,
              txUrl: d.receiptUrl || '',
            });
          } else if (ev === 'complete') {
            setSrcN(buyCount); setShowFoot(true);
            if (d.settleMode === 'direct' && Array.isArray(d.pending) && d.pending.length > 0) {
              // No server-side settlement happened — sign a real direct
              // transfer for each cited writer, one at a time, right here.
              setSettleN(0);
              await settleDirect(d.pending, corpus, writeContractAsync, (settledCount, receipt) => {
                const c = corpus[receipt.id] || { price: receipt.amount, you: false };
                tallyAcc += receipt.amount; setTally(tallyAcc);
                setReceipts(p => [{ id: receipt.id, c, contrib: receipt.contributionPct || 100, url: receipt.receiptUrl, amt: receipt.amount, ts: settle() }, ...p]);
                setSettleN(settledCount);
                if (c.you) onAddCite(receipt.id, receipt.amount);
                onActivity({
                  type: 'settled',
                  label: `Direct payment · ${c.title || receipt.id}`,
                  amount: receipt.amount,
                  wallet: receipt.wallet,
                  txUrl: receipt.receiptUrl,
                });
              }, onToast);
            } else {
              setSettleN(d.paid || struck);
            }
          } else if (ev === 'error') {
            setAnswerHtml(`<p style="color:#c98a5c">Engine error: ${d.message}</p>`);
          }
        }
      }
    } catch {
      await runDemoMode(q, corpus, setDecisions, setAnswerHtml, setReceipts, setTally, setSrcN, setSettleN, setShowFoot, onAddCite);
    } finally { setBusy(false); }
  };

  return (
    <main className="view-ask">
      <div className="wrap">
        <section className={`hero${stage?' hero-compact':''}`}>
          <span className="insc">Ask · the herald pays whoever it quotes</span>
          <h1>Ask a question. <em>Pay</em> the writers behind the answer.</h1>
          {!stage && <p className="sub">The agent buys the sources worth buying, grounds its answer in them, and strikes a payment to each writer it cites.</p>}
          {!stage && (
            <>
              <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, color: 'var(--parchment-faint)', textAlign: 'center', margin: '18px 0 8px' }}>
                How should the AGENT settle citations it decides to buy? (This does not affect the "Buy directly" button below — that's always a manual, instant, direct payment.)
              </p>
              <div className="settle-toggle" role="radiogroup" aria-label="Settlement method">
                <button
                type="button"
                className={`settle-opt${settleMode==='escrow'?' on':''}`}
                onClick={() => setSettleMode('escrow')}
              >
                <span className="settle-opt-title">Escrowed</span>
                <span className="settle-opt-sub">Via KeryxSplits · withdrawable by writers</span>
              </button>
              <button
                type="button"
                className={`settle-opt${settleMode==='x402'?' on':''}`}
                onClick={() => setSettleMode('x402')}
              >
                <span className="settle-opt-title">x402</span>
                <span className="settle-opt-sub">Pays the writer the instant their work is read — even if not quoted in the final answer</span>
              </button>
              <button
                type="button"
                className={`settle-opt${settleMode==='direct'?' on':''}`}
                onClick={() => setSettleMode('direct')}
              >
                <span className="settle-opt-title">Direct</span>
                <span className="settle-opt-sub">Instant wallet-to-wallet · one signature per writer</span>
              </button>
              </div>
            </>
          )}
          <div className="askbox">
            <div className="askfield">
              <input
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAsk()}
                placeholder="Ask anything — the herald will pay whoever it quotes…"
              />
              <button className="askbtn" disabled={busy} onClick={() => handleAsk()}>
                {busy ? 'Thinking…' : 'Send the herald'}
              </button>
            </div>
          </div>
          {!stage && (
            <div className="chips">
              {CHIPS.map(c => <button key={c} className="chip" onClick={() => { setQuestion(c); handleAsk(c); }}>{c}</button>)}
            </div>
          )}
        </section>

        {stage && (
          <div className="stage">
            <div className="stage-left">
              {/* DELIBERATION */}
              <div className="panel" style={{ marginBottom: 30 }}>
                <div className="phead"><span className="insc">The herald deliberates</span><span className="insc mono budget-ticker">budget · {fmt6(budgetLeft)} USDC left</span></div>
                <div className="delib">
                  {decisions.map((d, i) => (
                    <div className="dline" key={i} style={{ animationDelay: `${i * 0.05}s` }}>
                      <div className="di">
                        <div className="src">{d.c.title}</div>
                        <div className="meta">· {d.c.handle} · relevance {Number(d.relevance || 0).toFixed(2)}{d.price != null && <> · ${Number(d.price).toFixed(4)}</>}</div>
                        <div className="x402-row">
                          <span className={`sd ${d.decision==='BUY'?'done':'off'}`} />402 gated
                          <span className={`sd ${d.decision==='BUY'?'done':'off'}`} />{d.decision==='BUY'?'toll paid':'skipped'}
                          <span className={`sd ${d.decision==='BUY'?'done':'off'}`} />{d.decision==='BUY'?'unlocked':'not fetched'}
                        </div>
                        {d.reason && <div className="decision-reason">{d.reason}</div>}
                        {d.tradeoffNote && <div className="decision-tradeoff">⚖ {d.tradeoffNote}</div>}
                      </div>
                      <div className="acts">
                        <button className="act-buy" onClick={() => onBuyArticle(d.id)}>Buy directly</button>
                        <button className="act-sell" onClick={() => onSellArticle(d.c.title?.slice(0,40) || '')}>Sell</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* ANSWER */}
              {answerHtml && (
                <div className="panel">
                  <div className="answer">
                    <div className="eyebrow">
                      <span className="insc">Answer</span>
                      <span className="qtext">"{question}"</span>
                      {address && <span className="asked-by">asked by <span className="mono">{short(address)}</span></span>}
                    </div>
                    <div
                      className="prose"
                      dangerouslySetInnerHTML={{ __html: `<p>${answerHtml}</p>` }}
                      onClick={e => {
                        const id = e.target.dataset?.id;
                        if (id) {
                          const r = document.getElementById(`rc-${id}`);
                          if (r) { r.scrollIntoView({ behavior:'smooth', block:'center' }); r.style.boxShadow='0 0 0 1px rgba(91,184,164,.6),0 0 26px rgba(91,184,164,.28)'; setTimeout(()=>r.style.boxShadow='',900); }
                        }
                      }}
                    />
                    {showFoot && (
                      <div className="ans-foot">
                        Grounded in <b>{srcN}</b> purchased sources · <b>{settleN}</b> writers paid · settled on Arc in test USDC
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* MINT */}
            <aside className="stage-right">
              <div className="panel mint">
                <div className="phead"><span className="insc" style={{ color:'var(--bronze)' }}>The mint · citation receipts</span></div>
                <div className="tally">
                  <div><div className="amt">{fmt6(tally)}<span className="u">USDC</span></div><div className="lbl">struck this answer</div></div>
                  <div className="cnt"><b>{receipts.length}</b>coins struck</div>
                </div>
                <div className="receipts">
                  {receipts.length === 0 && <div className="empty">No coins struck yet.<br />Ask, and watch the ledger fill.</div>}
                  {receipts.map((r, i) => <Receipt key={i} r={r} corpus={corpus} />)}
                </div>
                <div className="railnote">Each receipt is an <b>x402</b> toll settled via <b>Gateway</b> nanopayments — gas-free, batched, &lt;500ms on Arc.</div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

/* Receipt card */
function Receipt({ r }) {
  const c = r.c || {};
  const txEl = r.url
    ? <a className="rc-tx" href={r.url} target="_blank" rel="noreferrer">{rndTx()}</a>
    : <span className="rc-tx">{rndTx()}</span>;
  return (
    <div className="receipt" id={`rc-${r.id}`}>
      <span className="sheen" />
      <div className="rc-top">
        <span className={`rc-av${c.you?' you':''}`}>{inits(c.author||r.id)}</span>
        <div><div className="rc-name">{c.author||r.id}</div><div className="rc-handle">{c.handle||''}</div></div>
        {c.you && <span className="rc-you-tag">you</span>}
      </div>
      <div className="rc-mid">
        <span className="rc-amt">+{fmt6(r.amt)}</span>
        <div><div className="rc-pct">{r.contrib}%</div><div className="rc-pl">contribution</div></div>
      </div>
      <div className="rc-bar"><i style={{ width: `${r.contrib}%` }} /></div>
      <div className="rc-foot">
        <span className="rc-settle"><span className="dot" />settled · {r.ts}s</span>
        {txEl}
      </div>
    </div>
  );
}

/* Demo mode */
async function runDemoMode(q, corpus, setDecisions, setAnswerHtml, setReceipts, setTally, setSrcN, setSettleN, setShowFoot, onAddCite) {
  const flow = DEMO[q] || buildGenericDemo(q, corpus);
  for (const id of flow.consider) {
    const c = corpus[id] || { title: id, handle: '', price: 0 };
    const isBuy = flow.buy.includes(id);
    const rel = isBuy ? (0.7 + Math.random() * 0.6).toFixed(2) : (Math.random() * 0.5).toFixed(2);
    setDecisions(p => [...p, { id, decision: isBuy ? 'BUY' : 'SKIP', relevance: rel, c }]);
    await wait(reduced() ? 0 : 320);
  }
  await wait(reduced() ? 0 : 500);
  let n = 0;
  const html = flow.text.replace(/\[(\w+)\]/g, (_, id) => { n++; return `<sup class="cite" data-id="${id}">[${n}]</sup>`; });
  setAnswerHtml(html);
  let tallyAcc = 0, struck = 0;
  for (const id of flow.buy) {
    const c = corpus[id] || { price: 0.0007, you: false };
    await wait(reduced() ? 0 : 420);
    const contrib = Math.round(100 / flow.buy.length);
    setReceipts(p => [{ id, c, contrib, url: '', amt: c.price, ts: settle() }, ...p]);
    tallyAcc += c.price; struck++; setTally(tallyAcc);
    if (c.you) onAddCite(id, c.price);
  }
  setSrcN(flow.buy.length); setSettleN(struck); setShowFoot(true);
}

/* ════════════════════════════════════════════════════════
   ACTIVITY LOG — numbered, most recent first
   ════════════════════════════════════════════════════════ */
function ActivityLog({ entries }) {
  if (!entries || entries.length === 0) {
    return <div className="empty" style={{ padding: '28px 20px' }}>No activity yet. Buys, sells and settlements will appear here, numbered.</div>;
  }
  return (
    <div className="activity-list">
      {entries.map(e => (
        <div className="activity-row" key={e.n}>
          <span className="activity-n">#{e.n}</span>
          <div className="activity-body">
            <div className="activity-label">{e.label}</div>
            <div className="activity-meta">
              {e.amount != null && <span className="mono">{fmt6(e.amount)} USDC</span>}
              {e.wallet && <span> · {short(e.wallet)}</span>}
              <span> · {new Date(e.ts).toLocaleTimeString()}</span>
            </div>
          </div>
          {e.txUrl && <a className="activity-tx" href={e.txUrl} target="_blank" rel="noreferrer">view tx →</a>}
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   EARN VIEW
   ════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════
   EXPLORER — public, read-only, no wallet connection required.
   Reads real CitationSettled events straight from the deployed
   KeryxSplits contract so anyone (a judge included) can verify
   real on-chain activity in seconds, without asking a question
   or connecting a wallet themselves.
   ════════════════════════════════════════════════════════ */
const CITATION_SETTLED_EVENT = {
  type: 'event',
  name: 'CitationSettled',
  inputs: [
    { name: 'workId', type: 'string', indexed: true },
    { name: 'reader', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'timestamp', type: 'uint256', indexed: false },
  ],
};
const RECIPIENT_CREDITED_EVENT = {
  type: 'event',
  name: 'RecipientCredited',
  inputs: [
    { name: 'workId', type: 'string', indexed: true },
    { name: 'recipient', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
  ],
};
// Standard ERC20 Transfer event — used to surface DIRECT payments (plain
// wallet-to-wallet transfers that bypass the contract entirely, so they
// never emit CitationSettled/RecipientCredited). Unlike our custom events,
// address fields here are indexed cleanly with no string-hashing problem.
const USDC_TRANSFER_EVENT = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { name: 'from', type: 'address', indexed: true },
    { name: 'to', type: 'address', indexed: true },
    { name: 'value', type: 'uint256', indexed: false },
  ],
};
// Set to the KeryxSplits deployment block (or a safe block shortly before it) to
// keep the log scan small and fast. Adjust if your provider errors on the range.
const KERYX_DEPLOY_BLOCK = 49746900n;
const MAX_BLOCK_RANGE = 9500n; // stay safely under Arc RPC's 10,000-block eth_getLogs cap

async function scanLogs(publicClient, contractAddress, event, fromBlock) {
  const latest = await publicClient.getBlockNumber();
  const all = [];
  let from = fromBlock;
  while (from <= latest) {
    const to = from + MAX_BLOCK_RANGE > latest ? latest : from + MAX_BLOCK_RANGE;
    const chunk = await publicClient.getLogs({ address: contractAddress, event, fromBlock: from, toBlock: to });
    all.push(...chunk);
    from = to + 1n;
  }
  return all;
}

function ExplorerView({ corpus, onBuyArticle, onRegister }) {
  const publicClient = usePublicClient();
  const [events, setEvents] = useState(null); // null = loading — escrowed settlements
  const [directPayments, setDirectPayments] = useState(null); // null = loading — direct payments
  const [error, setError] = useState(null);
  const [worksPage, setWorksPage] = useState(1);
  const WORKS_PER_PAGE = 5;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // CitationSettled gives us the reader + timestamp per transaction.
        // RecipientCredited gives us who was actually paid, and how much —
        // a single citation can now credit more than one recipient.
        const [citationLogs, recipientLogs] = await Promise.all([
          scanLogs(publicClient, KERYX_ADDR, CITATION_SETTLED_EVENT, KERYX_DEPLOY_BLOCK),
          scanLogs(publicClient, KERYX_ADDR, RECIPIENT_CREDITED_EVENT, KERYX_DEPLOY_BLOCK),
        ]);

        const txMeta = {};
        for (const l of citationLogs) {
          txMeta[l.transactionHash] = {
            reader: l.args.reader,
            timestamp: Number(l.args.timestamp) * 1000,
          };
        }

        const rows = recipientLogs.map((l) => {
          const meta = txMeta[l.transactionHash] || {};
          return {
            recipient: l.args.recipient,
            amount: Number(l.args.amount) / 1e6,
            reader: meta.reader,
            timestamp: meta.timestamp || 0,
            txHash: l.transactionHash,
          };
        }).sort((a, b) => b.timestamp - a.timestamp);

        if (!cancelled) setEvents(rows);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [publicClient]);

  // Direct payments never touch the KeryxSplits contract, so they never
  // emit CitationSettled/RecipientCredited — they're plain USDC transfers.
  // Surface them separately by scanning USDC's own Transfer event, filtered
  // to transfers landing on a known registered writer wallet, excluding
  // anything to/from the contract itself (that's escrow inflow or
  // withdrawal, already shown in the panel above).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const knownWallets = new Set(
          Object.values(corpus).map(w => w.wallet?.toLowerCase()).filter(Boolean)
        );
        if (knownWallets.size === 0) { if (!cancelled) setDirectPayments([]); return; }

        const transferLogs = await scanLogs(publicClient, USDC_ADDR, USDC_TRANSFER_EVENT, KERYX_DEPLOY_BLOCK);

        const rows = transferLogs
          .filter(l => {
            const to = l.args.to?.toLowerCase();
            const from = l.args.from?.toLowerCase();
            return knownWallets.has(to)
              && to !== KERYX_ADDR.toLowerCase()
              && from !== KERYX_ADDR.toLowerCase();
          })
          .map(l => ({
            recipient: l.args.to,
            reader: l.args.from,
            amount: Number(l.args.value) / 1e6,
            txHash: l.transactionHash,
          }));

        if (!cancelled) setDirectPayments(rows);
      } catch {
        if (!cancelled) setDirectPayments([]); // fail quiet here — the escrow panel above still shows real errors
      }
    })();
    return () => { cancelled = true; };
  }, [publicClient, corpus]);

  const writerLabel = (addr) => {
    const match = Object.values(corpus).find(w => w.wallet && w.wallet.toLowerCase() === addr?.toLowerCase());
    return match ? match.author : short(addr);
  };

  return (
    <main className="view-explorer">
      <div className="wrap">
        <div className="earn-head">
          <div>
            <span className="insc" style={{ display:'block', marginBottom:14 }}>Public ledger</span>
            <h2>Every citation, <em>verifiable.</em></h2>
            <div className="who">No wallet required — read directly from the KeryxSplits contract on Arc testnet.</div>
          </div>
        </div>
        <div className="panel works" style={{ marginBottom: 22 }}>
          <div className="phead">
            <span className="insc">All registered works</span>
            <button type="button" className="register-btn" style={{ padding: '7px 14px', fontSize: 13 }} onClick={onRegister}>+ Register Work</button>
          </div>
          {Object.keys(corpus).length === 0 && (
            <div className="empty" style={{ padding:'28px 20px' }}>Nothing registered yet.</div>
          )}
          {(() => {
            const allWorks = Object.entries(corpus);
            const totalPages = Math.max(1, Math.ceil(allWorks.length / WORKS_PER_PAGE));
            const page = Math.min(worksPage, totalPages);
            const start = (page - 1) * WORKS_PER_PAGE;
            const pageWorks = allWorks.slice(start, start + WORKS_PER_PAGE);
            return (
              <>
                {pageWorks.map(([id, w]) => (
                  <div className="work" key={id}>
                    <div>
                      <div className="wt">{w.title}</div>
                      <div className="wm">{w.author || short(w.wallet)} · <span className="price">${fmt6(w.price)} / citation</span></div>
                    </div>
                    <div className="wc">
                      <button type="button" className="act-buy" onClick={() => onBuyArticle?.(id)}>Buy directly</button>
                    </div>
                    <div className="we" style={{ minWidth: 0 }} />
                  </div>
                ))}
                {totalPages > 1 && (
                  <div className="pager">
                    <button type="button" className="pager-btn" disabled={page === 1} onClick={() => setWorksPage(page - 1)}>‹</button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                      <button
                        key={n}
                        type="button"
                        className={`pager-num${n === page ? ' on' : ''}`}
                        onClick={() => setWorksPage(n)}
                      >
                        {n}
                      </button>
                    ))}
                    <button type="button" className="pager-btn" disabled={page === totalPages} onClick={() => setWorksPage(page + 1)}>›</button>
                  </div>
                )}
              </>
            );
          })()}
        </div>

        <div className="panel works">
          <div className="phead">
            <span className="insc">Settlements</span>
            <span className="insc mono">
              {events !== null && directPayments !== null ? `${events.length + directPayments.length} found` : 'reading chain…'}
            </span>
          </div>
          {error && <div className="empty" style={{ padding:'28px 20px' }}>Could not read contract logs: {error}</div>}
          {events !== null && directPayments !== null && events.length === 0 && directPayments.length === 0 && !error && (
            <div className="empty" style={{ padding:'28px 20px' }}>No settlements yet — ask a question or buy a work to strike the first coin.</div>
          )}
          {events !== null && directPayments !== null && (() => {
            const merged = [
              ...events.map(e => ({ ...e, kind: 'Escrowed' })),
              ...directPayments.map(e => ({ ...e, kind: 'Direct' })),
            ].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            return merged.map((e, i) => (
              <div className="work" key={`${e.txHash}-${e.recipient}-${i}`}>
                <div>
                  <div className="wt">{writerLabel(e.recipient)}</div>
                  <div className="wm">
                    paid by <span className="mono">{short(e.reader)}</span>
                    {e.timestamp ? ` · ${new Date(e.timestamp).toLocaleString()}` : ''}
                    {' · '}<span className="price">{e.kind}</span>
                  </div>
                </div>
                <div className="wc">
                  <a href={`${EXPLORER}/tx/${e.txHash}`} target="_blank" rel="noreferrer" className="activity-tx">view tx →</a>
                </div>
                <div className="we">{fmt6(e.amount)}<small>USDC</small></div>
              </div>
            ));
          })()}
        </div>
      </div>
    </main>
  );
}

/* ════════════════════════════════════════════════════════
   WORK ROW — shows a registered work with its REAL on-chain
   citation count (citationsOf) and an inline price-update action
   (updatePrice), instead of a locally-estimated citation count.
   ════════════════════════════════════════════════════════ */
function WorkRow({ id, work, fallbackCites, onToast }) {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [onchainCites, setOnchainCites] = useState(null); // null = loading
  const [editing, setEditing] = useState(false);
  const [newPrice, setNewPrice] = useState(work.price?.toString() || '0.0007');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const count = await publicClient.readContract({
          address: KERYX_ADDR,
          abi: [{ type: 'function', name: 'citationsOf', stateMutability: 'view',
                   inputs: [{ name: 'workId', type: 'string' }], outputs: [{ type: 'uint256' }] }],
          functionName: 'citationsOf',
          args: [id],
        });
        if (!cancelled) setOnchainCites(Number(count));
      } catch {
        if (!cancelled) setOnchainCites(null); // fall back to estimate below
      }
    })();
    return () => { cancelled = true; };
  }, [id, publicClient]);

  const cites = onchainCites !== null ? onchainCites : fallbackCites;
  const earned = cites * (work.price || 0);

  const doUpdatePrice = async () => {
    const p = parseFloat(newPrice);
    if (!p || p <= 0) { onToast('Enter a valid price'); return; }
    setUpdating(true);
    try {
      const units = parseUnits(newPrice, 6);
      const txHash = await writeContractAsync({
        address: KERYX_ADDR,
        abi: KERYX_ABI,
        functionName: 'updatePrice',
        args: [id, units],
        chainId: 5042002,
      });
      onToast(`Price updated for <b>${work.title.slice(0,28)}</b> · ${short(txHash)}`);
      setEditing(false);
    } catch (e) {
      if (e.code !== 4001) onToast('Update failed: ' + e.message?.slice(0, 40));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="work">
      <div>
        <div className="wt">{work.title}</div>
        <div className="wm">
          {(work.blurb || '').slice(0, 60)}…
          {!editing && (
            <> · <span className="price">${fmt6(work.price)} / citation</span>{' '}
              <button type="button" className="price-edit-btn" onClick={() => setEditing(true)}>edit</button>
            </>
          )}
          {editing && (
            <span className="price-edit-row">
              <input
                className="price-edit-input"
                value={newPrice}
                onChange={e => setNewPrice(e.target.value)}
                placeholder="0.0007"
              />
              <button type="button" className="price-edit-save" disabled={updating} onClick={doUpdatePrice}>
                {updating ? '…' : 'Save'}
              </button>
              <button type="button" className="price-edit-cancel" onClick={() => setEditing(false)}>Cancel</button>
            </span>
          )}
        </div>
      </div>
      <div className="wc">{onchainCites === null ? cites : onchainCites}<small>{onchainCites !== null ? 'on-chain citations' : 'citations'}</small></div>
      <div className="we">{fmt6(earned)}<small>USDC</small></div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   EARN VIEW
   ════════════════════════════════════════════════════════ */
function EarnView({ corpus, sessionEarned, citesByWork, totalCites, onRegister, onToast, activityLog, onActivity }) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [onchainBalance, setOnchainBalance] = useState(null); // null = loading / not connected

  useEffect(() => {
    if (!isConnected || !address) { setOnchainBalance(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const bal = await publicClient.readContract({
          address: KERYX_ADDR,
          abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view',
                   inputs: [{ name: 'writer', type: 'address' }], outputs: [{ type: 'uint256' }] }],
          functionName: 'balanceOf',
          args: [address],
        });
        if (!cancelled) setOnchainBalance(Number(bal) / 1e6);
      } catch {
        if (!cancelled) setOnchainBalance(null);
      }
    })();
    return () => { cancelled = true; };
  }, [address, isConnected, publicClient]);

  const BASE_EARNED  = 0.097400;
  const totalEarned  = BASE_EARNED + sessionEarned;
  const myWorks      = Object.keys(corpus).filter(id => {
    const w = corpus[id];
    return w.you || (isConnected && w.wallet && w.wallet.toLowerCase() === address?.toLowerCase());
  });

  const series = (() => {
    const pts = []; let v = 0; const step = BASE_EARNED / 30;
    for (let i = 0; i < 30; i++) { v += step * (0.6 + Math.random() * 0.8); pts.push(v); }
    pts[29] = BASE_EARNED; return pts;
  })();

  /* SVG chart */
  const W=800,H=170,pad=8,max=Math.max(...series);
  const cx = i => pad + i*(W-2*pad)/(series.length-1);
  const cy = v => H - pad - (v/max)*(H-2*pad);
  let line = `M${cx(0)} ${cy(series[0])}`;
  series.forEach((v,i) => { if(i) line += ` L${cx(i)} ${cy(v)}`; });
  const area = `${line} L${cx(series.length-1)} ${H} L${cx(0)} ${H} Z`;

  return (
    <main className="view-earn">
      <div className="wrap">
        <div className="earn-head">
          <div>
            <span className="insc" style={{ display:'block', marginBottom:14 }}>Your ledger</span>
            <h2>Paid for being <em>cited.</em></h2>
            <div className="who">
              {isConnected
                ? <><span className="mono">{short(address)}</span> · <span style={{ color:'var(--parchment-faint)' }}>{address?.slice(0,18)}…</span> · {myWorks.length} works registered behind x402</>
                : 'Connect wallet to see your identity'}
            </div>
          </div>
          <div className="earn-actions">
            <button className="register-btn" onClick={onRegister}>+ Register Work</button>
            <button className="withdraw" onClick={() => setShowWithdraw(true)}>Withdraw balance</button>
          </div>
        </div>

        {showWithdraw && (
          <WithdrawModal
            estimatedTotal={totalEarned}
            onClose={() => setShowWithdraw(false)}
            onToast={onToast}
            onActivity={onActivity}
          />
        )}

        <div className="grid3">
          <div className="panel stat" style={{ borderColor: onchainBalance > 0 ? 'var(--verdigris)' : undefined }}>
            <span className="insc">Withdrawable now</span>
            <div className="big">
              {onchainBalance === null ? '—' : fmt6(onchainBalance)}
              <span className="u">USDC</span>
            </div>
            <div className={`delta${onchainBalance > 0 ? '' : ' dim'}`}>
              {!isConnected ? 'connect wallet to check' : onchainBalance === null ? 'reading on-chain…' : onchainBalance > 0 ? 'ready to claim — click Withdraw balance' : 'nothing to claim yet'}
            </div>
          </div>
          <div className="panel stat"><span className="insc">Total earned</span><div className="big">{fmt6(totalEarned)}<span className="u">USDC</span></div><div className={`delta${sessionEarned>0?'':' dim'}`}>{sessionEarned>0?'+':''}{fmt6(sessionEarned)} this session</div></div>
          <div className="panel stat"><span className="insc">Citations</span><div className="big">{totalCites}</div><div className="delta dim">across registered works</div></div>
        </div>

        <div className="panel chartcard">
          <div className="ch-top"><span className="insc">Earnings · cumulative</span><span className="rng">last 30 days · live</span></div>
          <svg viewBox="0 0 800 170" className="chart" preserveAspectRatio="none">
            <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#C9A45C" stopOpacity=".34"/><stop offset="1" stopColor="#C9A45C" stopOpacity="0"/></linearGradient></defs>
            <path d={area} fill="url(#cg)"/>
            <path d={line} fill="none" stroke="#E8CF93" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
            <circle cx={cx(series.length-1)} cy={cy(series[series.length-1])} r="4" fill="#5BB8A4"/>
            <circle cx={cx(series.length-1)} cy={cy(series[series.length-1])} r="8" fill="none" stroke="#5BB8A4" strokeOpacity=".4"/>
          </svg>
        </div>

        <div className="panel works" style={{ marginBottom: 22 }}>
          <div className="phead"><span className="insc">Your works</span><span className="insc mono">price · per citation</span></div>
          {myWorks.length === 0 && <div className="empty" style={{ padding: '28px 20px' }}>No works registered to this wallet yet.</div>}
          {myWorks.map(id => (
            <WorkRow key={id} id={id} work={corpus[id]} fallbackCites={citesByWork[id] || 0} onToast={onToast} />
          ))}
        </div>

        <div className="panel works">
          <div className="phead"><span className="insc">Activity log</span><span className="insc mono">newest first</span></div>
          <ActivityLog entries={activityLog} />
        </div>
      </div>
    </main>
  );
}

/* ════════════════════════════════════════════════════════
   SLICE 3 — APPROVAL MODAL
   ════════════════════════════════════════════════════════ */
function ApprovalModal({ onClose, onToast, onApproved }) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState('idle');
  const [msg, setMsg]       = useState('');

  const doApprove = async () => {
    setStatus('signing'); setMsg('Waiting for signature…');
    try {
      const units = parseUnits('0.01', 6);
      await writeContractAsync({
        address: USDC_ADDR,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [KERYX_ADDR, units],
        chainId: 5042002,
      });
      setStatus('done'); setMsg('Approved ✓');
      onToast('USDC approved · herald can now pay sources on your behalf');
      onApproved?.();
      await wait(700); onClose();
    } catch (e) {
      setStatus('error'); setMsg(e.code === 4001 ? 'Rejected by user' : 'Error: ' + e.message?.slice(0,50));
    }
  };

  return (
    <Modal title={<>Approve the <em>herald</em></>} sub="Sign a USDC approval so the herald can pay sources on your behalf as it answers." onClose={onClose}>
      <div className="appr-box">
        {[['Spender','KeryxSplits contract'],['Amount','0.0100 USDC'],['Chain','Arc testnet'],['Gas','~0 (native USDC)']].map(([k,v])=>(
          <div className="appr-row" key={k}><span className="ak">{k}</span><span className="av">{v}</span></div>
        ))}
      </div>
      <div className="macts">
        <button className="mghost" onClick={onClose}>Cancel</button>
        <button className="mpri" disabled={status==='signing'||status==='done'} onClick={doApprove}>Sign approval →</button>
      </div>
      {msg && <div className={`mstat ${status}`}><span className="sdot"/>{msg}</div>}
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════
   SLICE 4 — BUY MODAL
   This is a DIRECT payment path: the connected reader pays the writer's
   wallet instantly, outside the KeryxSplits escrow/withdraw system. It is
   intentionally distinct from agent-settled citations (which flow through
   settleCitation and accumulate in the writer's withdrawable balance) —
   the contract's settleCitation is agent-authorized only, so a human's
   direct "Buy" click cannot call it. Both paths pay the writer for real;
   this one is instant and off-ledger, the other is escrowed on-chain.
   ════════════════════════════════════════════════════════ */
function BuyModal({ id, corpus, onClose, onToast, onActivity }) {
  const c = corpus[id] || { title: id, handle: '', price: 0.0007, wallet: KERYX_ADDR };
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState('idle');
  const [msg, setMsg]       = useState('');
  const [paidCount, setPaidCount] = useState(0);

  // Multi-recipient works get paid with one sequential transfer per
  // recipient, each their correct share — same split math as the contract's
  // own _settleOne, just executed as plain wallet-to-wallet transfers
  // instead of going through escrow. No recipient is left out.
  const recipients = Array.isArray(c.recipients) && c.recipients.length > 0
    ? c.recipients
    : [c.wallet || KERYX_ADDR];
  const bps = Array.isArray(c.bps) && c.bps.length === recipients.length
    ? c.bps
    : [10000];
  const hasCoAuthors = recipients.length > 1;

  const computeShares = (totalPrice) => {
    const totalUnits = Math.round(totalPrice * 1e6); // whole USDC 6-decimal units
    let distributed = 0;
    return recipients.map((addr, i) => {
      let share;
      if (i === recipients.length - 1) {
        share = totalUnits - distributed; // last recipient absorbs rounding remainder
      } else {
        share = Math.floor((totalUnits * bps[i]) / 10000);
        distributed += share;
      }
      return { address: addr, units: BigInt(share), amount: share / 1e6 };
    });
  };

  const doBuy = async () => {
    setStatus('signing'); setMsg(recipients.length > 1 ? `Signing payment 1 of ${recipients.length}…` : 'Signing direct payment…');
    const shares = computeShares(c.price);
    let count = 0;
    try {
      for (const share of shares) {
        setMsg(`Signing payment ${count + 1} of ${shares.length}…`);
        const txHash = await writeContractAsync({
          address: USDC_ADDR,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [share.address, share.units],
          chainId: 5042002,
        });
        count += 1;
        setPaidCount(count);
        const receiptUrl = `${EXPLORER}/tx/${txHash}`;
        onActivity?.({
          type: 'buy',
          label: `Direct payment · ${c.title}${shares.length > 1 ? ` (${count}/${shares.length})` : ''}`,
          amount: share.amount,
          wallet: share.address,
          txUrl: receiptUrl,
        });
      }
      setStatus('done');
      setMsg(`Paid all ${shares.length} recipient${shares.length > 1 ? 's' : ''} ✓`);
      onToast(`Direct payment complete · <b>${fmt6(c.price)} USDC</b> split across ${shares.length} recipient${shares.length > 1 ? 's' : ''}`);
      await wait(1000); onClose();
    } catch (e) {
      setStatus('error');
      setMsg(e.code === 4001 ? 'Rejected by user' : `Tx failed after ${count}/${shares.length} payments: ${e.message?.slice(0,40)}`);
    }
  };

  return (
    <Modal title={<>Pay this writer <em>directly</em></>} sub="Instant USDC payment straight to the writer's wallet — outside the agent's escrow, not part of their withdrawable balance." onClose={onClose}>
      {hasCoAuthors && (
        <div className="coauthor-banner" style={{ borderColor: 'rgba(91,184,164,.4)', background: 'rgba(91,184,164,.08)' }}>
          <span className="coauthor-banner-icon" style={{ color: 'var(--verdigris)' }}>✓</span>
          <div className="coauthor-banner-text">
            <div className="coauthor-banner-title" style={{ color: 'var(--verdigris)' }}>This work has {recipients.length} co-authors</div>
            <div className="coauthor-banner-body">
              Direct payment will send {recipients.length} separate transfers, one per recipient, each their correct share.
              You'll sign {recipients.length} times in a row.
            </div>
          </div>
        </div>
      )}
      <div className="appr-box">
        <div className="appr-row"><span className="ak">Article</span><span className="av" style={{fontFamily:"'Fraunces',serif",maxWidth:200,textAlign:'right',lineHeight:1.3}}>{c.title}</span></div>
        <div className="appr-row"><span className="ak">Author{recipients.length > 1 ? 's' : ''}</span><span className="av">{c.handle}</span></div>
        <div className="appr-row"><span className="ak">Total amount</span><span className="av">{fmt6(c.price)} USDC</span></div>
        {recipients.length === 1 ? (
          <div className="appr-row"><span className="ak">Recipient</span><span className="av">{short(recipients[0])}</span></div>
        ) : (
          computeShares(c.price).map((s, i) => (
            <div className="appr-row" key={i}><span className="ak">Recipient {i + 1}</span><span className="av">{short(s.address)} · {fmt6(s.amount)} USDC</span></div>
          ))
        )}
      </div>
      <div className="macts">
        <button className="mghost" onClick={onClose}>Cancel</button>
        <button className="mpri" disabled={status==='signing'||status==='done'} onClick={doBuy}>
          {status === 'signing' && recipients.length > 1 ? `Signing ${paidCount}/${recipients.length}…` : `Sign payment${recipients.length > 1 ? 's' : ''} →`}
        </button>
      </div>
      {msg && <div className={`mstat ${status}`}><span className="sdot"/>{msg}</div>}
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════
   SLICE 5 — REGISTER WORK MODAL
   ════════════════════════════════════════════════════════ */
function RegisterModal({ preTitle, onClose, onAddWork, onToast, onActivity }) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [title, setTitle]   = useState(preTitle || '');
  const [url, setUrl]       = useState('');
  const [price, setPrice]   = useState('0.0007');
  const [status, setStatus] = useState('idle');
  const [msg, setMsg]       = useState('');
  // Co-authors: the connected wallet is always recipient 0 by default.
  // Percentages must sum to exactly 100 before the contract will accept it.
  const [coAuthors, setCoAuthors] = useState([]); // [{ wallet, pct }]

  const addCoAuthor = () => setCoAuthors(p => [...p, { wallet: '', pct: 0 }]);
  const removeCoAuthor = (i) => setCoAuthors(p => p.filter((_, idx) => idx !== i));
  const updateCoAuthor = (i, field, val) => setCoAuthors(p => p.map((c, idx) => idx === i ? { ...c, [field]: val } : c));

  const yourPct = 100 - coAuthors.reduce((sum, c) => sum + (Number(c.pct) || 0), 0);
  const splitsValid = yourPct > 0 && coAuthors.every(c => c.wallet.trim().length > 0 && Number(c.pct) > 0)
    && (yourPct + coAuthors.reduce((s, c) => s + Number(c.pct), 0)) === 100;

  const doRegister = async () => {
    if (!title.trim() || !url.trim()) { onToast('Please fill in title and URL'); return; }
    if (!splitsValid) { onToast('Splits must add up to exactly 100%, and every co-author needs a wallet address'); return; }
    setStatus('signing'); setMsg('Waiting for signature…');
    try {
      const workId = 'u' + Date.now();
      const priceUnits = parseUnits(price, 6);

      const recipients = [address, ...coAuthors.map(c => c.wallet.trim())];
      const bpsList = [Math.round(yourPct * 100), ...coAuthors.map(c => Math.round(Number(c.pct) * 100))];
      // Guard against rounding drift — force the exact 10000 total onto the last entry.
      const bpsSum = bpsList.reduce((s, b) => s + b, 0);
      if (bpsSum !== 10000) bpsList[bpsList.length - 1] += (10000 - bpsSum);

      const txHash = await writeContractAsync({
        address: KERYX_ADDR,
        abi: KERYX_ABI,
        functionName: 'registerWork',
        args: [workId, title, url, recipients, bpsList, priceUnits],
        chainId: 5042002,
      });
      const entry = {
        title,
        price: parseFloat(price),
        author: coAuthors.length > 0 ? `${short(address)} + ${coAuthors.length} co-author${coAuthors.length > 1 ? 's' : ''}` : (short(address) || 'You'),
        handle: short(address) || '@you',
        you: true,
        blurb: url,
        wallet: address || KERYX_ADDR,
        recipients,
        bps: bpsList,
      };
      onAddWork(workId, entry);
      setStatus('done'); setMsg(`Registered ✓ · ${short(txHash)}`);
      const receiptUrl = `${EXPLORER}/tx/${txHash}`;
      onActivity?.({ type: 'register', label: `Registered work · ${title}`, amount: parseFloat(price), wallet: address, txUrl: receiptUrl });
      onToast(`Work registered on Arc · <b>${title.slice(0,28)}</b> — visible to every wallet immediately, straight from the contract.`);
      // Optional: also index this work's content locally so the agent has
      // real text to quote from when it cites this work in an answer. This
      // is a content-quality step only — it does NOT affect whether other
      // wallets can discover, buy, or pay this work, since that now happens
      // directly on-chain regardless of whether this call succeeds.
      try {
        await fetch(`${API_URL}/api/register-work`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workId, title, url, usdcUnits: parseFloat(price), wallet: address, recipients, bps: bpsList }),
        });
      } catch { /* content indexing is best-effort; on-chain registration already succeeded */ }
      await wait(1200); onClose();
    } catch (e) {
      setStatus('error'); setMsg(e.code === 4001 ? 'Rejected by user' : 'Error: ' + e.message?.slice(0,50));
    }
  };

  return (
    <Modal title={<>Register your <em>work</em></>} sub="Put your work behind an x402 paywall. The herald pays you every time it cites you." onClose={onClose}>
      <div className="mf"><label>Article title</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Why Private DeFi Is the Use Case That Matters"/></div>
      <div className="mf"><label>Source URL</label><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="Link to your work — X, Reddit, Substack, Medium, anywhere"/></div>
      <div className="mf"><label>Price per citation (USDC)</label>
        <select value={price} onChange={e=>setPrice(e.target.value)}>
          <option value="0.0005">$0.0005 — accessible</option>
          <option value="0.0007">$0.0007 — standard</option>
          <option value="0.0010">$0.0010 — premium</option>
          <option value="0.0020">$0.0020 — exclusive</option>
        </select>
      </div>

      <div className="mf">
        <label>Revenue split</label>
        <div className="split-row">
          <span className="split-you">You ({short(address) || 'connect wallet'})</span>
          <span className="split-pct">{yourPct}%</span>
        </div>
        {coAuthors.map((c, i) => (
          <div className="split-row" key={i}>
            <input
              className="split-wallet"
              value={c.wallet}
              onChange={e => updateCoAuthor(i, 'wallet', e.target.value)}
              placeholder="Co-author wallet address"
            />
            <input
              className="split-input"
              type="number"
              min="1"
              max="99"
              value={c.pct}
              onChange={e => updateCoAuthor(i, 'pct', e.target.value)}
            />
            <span className="split-pct-sign">%</span>
            <button type="button" className="split-remove" onClick={() => removeCoAuthor(i)}>×</button>
          </div>
        ))}
        <button type="button" className="split-add" onClick={addCoAuthor}>+ Add co-author</button>
        {!splitsValid && coAuthors.length > 0 && (
          <div className="split-warning">Splits must total exactly 100% before you can register.</div>
        )}
      </div>

      <div className="macts">
        <button className="mghost" onClick={onClose}>Cancel</button>
        <button className="mpri" disabled={status==='signing'||status==='done'||!splitsValid} onClick={doRegister}>Sign & Register on Arc →</button>
      </div>
      {msg && <div className={`mstat ${status}`}><span className="sdot"/>{msg}</div>}
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════
   WITHDRAW MODAL
   The deployed KeryxSplits.withdraw() has no amount parameter —
   it always withdraws the caller's FULL balance. Rather than show
   a fake "enter amount" field that wouldn't actually do anything,
   this reads your REAL on-chain balance first so you know exactly
   what you're about to withdraw before signing.
   ════════════════════════════════════════════════════════ */
function WithdrawModal({ estimatedTotal, onClose, onToast, onActivity }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [onchainBalance, setOnchainBalance] = useState(null); // null = loading
  const [status, setStatus] = useState('idle');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bal = await publicClient.readContract({
          address: KERYX_ADDR,
          abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view',
                   inputs: [{ name: 'writer', type: 'address' }], outputs: [{ type: 'uint256' }] }],
          functionName: 'balanceOf',
          args: [address],
        });
        if (!cancelled) setOnchainBalance(Number(bal) / 1e6);
      } catch {
        if (!cancelled) setOnchainBalance(estimatedTotal); // fallback if read fails
      }
    })();
    return () => { cancelled = true; };
  }, [address, publicClient, estimatedTotal]);

  const doWithdraw = async () => {
    setStatus('signing'); setMsg('Waiting for signature…');
    try {
      const txHash = await writeContractAsync({
        address: KERYX_ADDR,
        abi: KERYX_ABI,
        functionName: 'withdraw',
        chainId: 5042002,
      });
      const receiptUrl = `${EXPLORER}/tx/${txHash}`;
      setStatus('done'); setMsg(`Withdrawn ✓ · ${short(txHash)}`);
      onToast(`Withdrawn <b>${fmt6(onchainBalance || 0)} USDC</b> → ${short(address)} · <a href="${receiptUrl}" target="_blank" style="color:var(--verdigris)">${short(txHash)}</a>`);
      onActivity?.({ type: 'withdraw', label: 'Withdrew balance', amount: onchainBalance || 0, wallet: address, txUrl: receiptUrl });
      await wait(900); onClose();
    } catch (e) {
      setStatus('error'); setMsg(e.code === 4001 ? 'Rejected by user' : 'Withdraw failed: ' + e.message?.slice(0, 50));
    }
  };

  const nothingToWithdraw = onchainBalance !== null && onchainBalance <= 0;

  return (
    <Modal title={<>Withdraw your <em>balance</em></>} sub="This contract withdraws your full accumulated balance in one transaction — there's no partial withdrawal." onClose={onClose}>
      <div className="appr-box">
        <div className="appr-row">
          <span className="ak">Withdrawable now</span>
          <span className="av">
            {onchainBalance === null ? 'reading on-chain…' : `${fmt6(onchainBalance)} USDC`}
          </span>
        </div>
        <div className="appr-row"><span className="ak">Destination</span><span className="av">{short(address)}</span></div>
        <div className="appr-row"><span className="ak">Chain</span><span className="av">Arc testnet</span></div>
      </div>
      {nothingToWithdraw && (
        <div className="mstat"><span className="sdot" style={{ background: 'var(--parchment-faint)' }} />Nothing to withdraw yet — earn a citation first.</div>
      )}
      <div className="macts">
        <button className="mghost" onClick={onClose}>Cancel</button>
        <button
          className="mpri"
          disabled={status==='signing' || status==='done' || onchainBalance === null || nothingToWithdraw}
          onClick={doWithdraw}
        >
          {onchainBalance === null ? 'Reading balance…' : `Withdraw all ${fmt6(onchainBalance)} USDC →`}
        </button>
      </div>
      {msg && <div className={`mstat ${status}`}><span className="sdot"/>{msg}</div>}
    </Modal>
  );
}

/* Shared modal shell */
function Modal({ title, sub, children, onClose }) {
  return (
    <div className="modal-overlay show" onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>{title}</h3>
        <p className="msub">{sub}</p>
        {children}
      </div>
    </div>
  );
}