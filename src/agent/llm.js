// src/agent/llm.js
// ---------------------------------------------------------------------------
// Pluggable LLM (OpenAI-compatible). Set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL.
// Works with OpenAI, or any compatible endpoint (local or hosted).
//
// Two calls define the agent's judgment:
//   decideSources() — economic buy/skip per candidate, against a budget.
//   groundAnswer()  — write the answer + assign a contribution % per cited work.
// ---------------------------------------------------------------------------

import 'dotenv/config';

const BASE = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const KEY = process.env.LLM_API_KEY;
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

async function chat(messages, { json = false } = {}) {
  if (!KEY) throw new Error('LLM_API_KEY not set');
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.3,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`llm -> ${res.status} ${JSON.stringify(data)}`);
  return data.choices[0].message.content;
}

/**
 * Decide which candidate sources are worth buying, on a budget.
 * candidates: [{ id, title, handle, price, snippet, relevance }]
 * Returns: [{ id, relevance: 0..1, decision: 'BUY'|'SKIP', reason }]
 */
export async function decideSources({ question, candidates, budget }) {
  const sys = `You are KERYX's acquisition agent. You answer questions by paying to read sources, on a strict budget.
Judge each candidate on value-for-money: does its content materially help answer THIS question, and is it worth its price?
BUY only sources that will actually shape the answer. SKIP weak or redundant ones. Stay within budget.
Return JSON: {"decisions":[{"id","relevance","decision","reason"}]}. relevance is 0..1. decision is "BUY" or "SKIP".`;
  const user = JSON.stringify({ question, budget_usdc: budget, candidates });
  const out = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { json: true });
  return JSON.parse(out).decisions;
}

/**
 * Ground an answer in the purchased sources and weight each one's contribution.
 * sources: [{ id, title, handle, text }]
 * Returns: { answer (with [id] inline markers), citations:[{id, contributionPct}] }
 */
export async function groundAnswer({ question, sources }) {
  const sys = `You are KERYX's answer engine. Write a clear, well-grounded answer to the question USING ONLY the provided sources.
Cite a source inline by appending its id in square brackets right after the claim it supports, e.g. [k2].
Only cite sources you genuinely used. Then assign each cited source a contribution percentage (integers summing to 100)
reflecting how much it shaped the answer.
Return JSON: {"answer":"...[id]...","citations":[{"id","contributionPct"}]}.`;
  const user = JSON.stringify({ question, sources });
  const out = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { json: true });
  return JSON.parse(out);
}
