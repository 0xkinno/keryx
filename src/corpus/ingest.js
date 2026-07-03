// src/corpus/ingest.js
// ---------------------------------------------------------------------------
// Incorporate Medium (or any) articles into KERYX.
//
//   node src/corpus/ingest.js                 # ingest data/works.seed.json
//   node src/corpus/ingest.js --register      # ...and register each on-chain
//
// For each work it: fetches + cleans the article text, splits it into chunks,
// stores it in the corpus, and (optionally) registers the work on KeryxSplits
// so it becomes payable.
// ---------------------------------------------------------------------------

import 'dotenv/config';
import fs from 'node:fs';
import { extract } from '@extractus/article-extractor';
import { agentWallet, publicClient } from '../chain/arc.js';
import { upsertWork } from './store.js';
import { keryxAbi, idHash, CONTRACT_ADDRESS } from '../settle/citation.js';
import { usdc } from '../chain/usdc.js';

const SEED = process.env.WORKS_SEED || 'data/works.seed.json';
const DO_REGISTER = process.argv.includes('--register');

function chunkText(text, size = 900) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const chunks = []; let cur = '';
  for (const s of sentences) {
    if ((cur + ' ' + s).length > size) { if (cur) chunks.push(cur.trim()); cur = s; }
    else cur += ' ' + s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

async function fetchArticle(url) {
  if (!url) return { title: '', text: '' };
  try {
    const a = await extract(url);
    if (a?.content) return { title: a.title, text: a.content.replace(/<[^>]+>/g, ' ') };
  } catch (e) {
    console.warn('  extract failed, falling back to raw fetch:', e.message);
  }
  const res = await fetch(url);
  const html = await res.text();
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  return { title: url, text };
}

async function registerOnchain(work) {
  if (!CONTRACT_ADDRESS) throw new Error('KERYX_CONTRACT_ADDRESS not set');
  const { client } = agentWallet();
  const recipients = work.recipients?.length ? work.recipients : [{ wallet: work.wallet, bps: 10000 }];

  // already on-chain? skip.
  try {
    await publicClient.readContract({ address: CONTRACT_ADDRESS, abi: keryxAbi, functionName: 'priceOf', args: [idHash(work.id)] });
    return 'already registered';
  } catch { /* not registered yet, continue */ }

  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS, abi: keryxAbi, functionName: 'registerWork',
    args: [idHash(work.id), recipients.map((r) => r.wallet), recipients.map((r) => r.bps), await usdcUnits(work.price)],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function main() {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  for (const w of seed) {
    process.stdout.write(`• ${w.id}  ${w.title}\n`);
    const { title, text } = await fetchArticle(w.url);
    const chunks = chunkText(text);
    const work = { ...w, title: w.title || title, chunks };
    upsertWork(work);
    console.log(`  ingested ${chunks.length} chunks`);
    if (DO_REGISTER) {
      try { const h = await registerOnchain(work); console.log('  registered on-chain:', h); }
      catch (e) { console.warn('  register skipped:', e.shortMessage || e.message); }
    }
  }
  console.log('\nCorpus ready. Run the agent or start the server.');
}

main().catch((e) => { console.error('ingest failed:', e.message); process.exit(1); });
