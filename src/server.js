// src/server.js
// ---------------------------------------------------------------------------
// KERYX API.
//   GET  /content/:workId     — x402-protected source (the publisher/seller side)
//   POST /api/ask             — runs the agent loop, streams progress over SSE
//   GET  /api/works           — the registered corpus (for the dashboard)
//   POST /api/register-work   — persist a newly-registered work to the corpus
//   GET  /api/health
//
// The /api/ask SSE event names match what the front-end prototype already
// renders: retrieved · decision · purchased · answer · settled · complete.
//
// x402 note: /content/:workId is now gated by settleX402Request(), which
// charges a fixed toll to PUBLISHER_ADDRESS for the agent's own read access.
// This is completely separate from author payments — citation settlement
// (escrow via settleAnswer, or direct wallet-to-wallet transfers) still
// happens exactly as before, untouched by this route.
// ---------------------------------------------------------------------------

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ask } from './agent/loop.js';
import { loadCorpus, upsertWork } from './corpus/store.js';
import { settleX402Request } from './circle/x402.js';

const app = express();
app.use(cors());
app.use(express.json());

// ---- Publisher (seller) side: x402 toll in front of each work's full text ----
app.get('/content/:workId', async (req, res) => {
  const work = loadCorpus().find((x) => x.id === req.params.workId);
  if (!work) return res.status(404).json({ error: 'unknown work' });

  let paid = false;
  try {
    paid = await settleX402Request(req, res, {
      workId: work.id,
      priceUsdc: work.price,
      resourceUrl: req.originalUrl,
      payTo: (work.recipients && work.recipients[0]) || work.wallet || undefined,
    });
  } catch (e) {
    // x402/Gateway misconfigured or unreachable — fail open to local content
    // rather than blocking the whole demo on a payment-rail outage. This
    // only affects the agent's own read-access step, never author payment.
    console.warn(`[x402] settleX402Request failed for ${work.id}, serving content directly:`, e.message);
    return res.type('text/plain').send((work.chunks || []).join('\n'));
  }

  if (!paid) return; // settleX402Request already sent the 402 response
  res.type('text/plain').send((work.chunks || []).join('\n'));
});

/**
 * JSON.stringify with a BigInt-safe replacer. viem returns on-chain uint256
 * values as native BigInt, which JSON.stringify cannot serialize by default.
 */
function safeStringify(payload) {
  return JSON.stringify(payload, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
}

// ---- Reader side: the agent answers, paying writers as it cites them ----
app.post('/api/ask', async (req, res) => {
  const { question, reader, settleMode } = req.body || {};
  if (!question) return res.status(400).json({ error: 'question required' });

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (type, payload) => res.write(`event: ${type}\ndata: ${safeStringify(payload)}\n\n`);

  try {
    await ask(question, { onEvent: send, reader, settleMode });
  } catch (e) {
    send('error', { message: e.message });
  } finally {
    res.end();
  }
});

app.get('/api/works', (_req, res) => {
  res.json(loadCorpus().map(({ chunks, ...meta }) => ({ ...meta, chunkCount: (chunks || []).length })));
});

/**
 * Persist a newly registered work into the corpus store, so it survives
 * page refreshes and shows up in future /api/ask retrieval. Called by the
 * frontend's RegisterModal, and by the Paragraph/Medium ingest scripts.
 */
app.post('/api/register-work', (req, res) => {
  const { workId, title, url, usdcUnits, wallet, recipients, bps } = req.body || {};
  if (!workId || !title) {
    return res.status(400).json({ error: 'workId and title are required' });
  }
  const work = upsertWork({
    id: workId,
    title,
    author: null,
    handle: null,
    wallet: wallet || '',
    price: Number(usdcUnits) || 0,
    url: url || '',
    recipients: recipients || (wallet ? [wallet] : []),
    bps: bps || (wallet ? [10000] : []),
    chunks: url ? [url] : [`Registered work: ${title}`],
  });
  res.json({ ok: true, work });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', works: loadCorpus().length, settleMode: process.env.SETTLE_MODE || 'onchain', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`KERYX API on http://localhost:${PORT}`));