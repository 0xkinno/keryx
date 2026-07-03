// src/corpus/store.js
// ---------------------------------------------------------------------------
// The registered corpus + a lightweight retriever.
//
// Each work: { id, title, author, handle, wallet, price, url, chunks[] }.
// Retrieval here is dependency-free (TF-style keyword overlap). Swap retrieve()
// for embeddings (e.g. Circle-hosted or local) without touching the agent loop.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

const FILE = process.env.CORPUS_FILE || path.resolve('data/corpus.json');

export function loadCorpus() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

export function saveCorpus(works) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(works, null, 2));
}

export function upsertWork(work) {
  const works = loadCorpus();
  const i = works.findIndex((w) => w.id === work.id);
  if (i >= 0) works[i] = { ...works[i], ...work };
  else works.push(work);
  saveCorpus(works);
  return work;
}

const STOP = new Set('the a an and or of to in on for is are be by with as at from that this it its into your you we our their not no'.split(' '));
const tokenize = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));

/**
 * Return up to `k` candidate works scored by keyword overlap against the query.
 * Each candidate carries the best-matching snippet for the agent to judge value.
 */
export function retrieve(query, k = 5) {
  const q = new Set(tokenize(query));
  const works = loadCorpus();
  const scored = works.map((w) => {
    const hay = `${w.title} ${(w.chunks || []).join(' ')}`;
    const toks = tokenize(hay);
    let score = 0;
    for (const t of toks) if (q.has(t)) score += 1;
    score = score / Math.sqrt(toks.length || 1); // length-normalise
    const snippet = bestSnippet(w.chunks || [], q) || w.title;
    return { ...w, relevance: score, snippet };
  });
  return scored.sort((a, b) => b.relevance - a.relevance).slice(0, k);
}

function bestSnippet(chunks, q) {
  let best = null, bestScore = -1;
  for (const c of chunks) {
    const toks = tokenize(c);
    let s = 0; for (const t of toks) if (q.has(t)) s += 1;
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best;
}
