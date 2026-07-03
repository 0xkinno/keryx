// scripts/sync-only.js
// ---------------------------------------------------------------------------
// Repopulates the backend's content index (data/corpus.json) for works that
// are ALREADY confirmed on-chain — no blockchain interaction here at all.
// Use this when register-seed.js correctly skipped works because they're
// already registered, but the local content cache still needs refilling
// (e.g. right after clearing corpus.json to remove stale duplicates).
//
// Usage:
//   node scripts/sync-only.js
// ---------------------------------------------------------------------------

import 'dotenv/config';

const API_URL = process.env.API_URL || 'http://localhost:4000';
const AGENT_ADDRESS = process.env.AGENT_ADDRESS || '0xe4B713e3cF2E550147f9cc09d751f276E7B9A64e';

const KNOWN_WORKS = [
  { workId: 'k1', title: "DeFi Doesn't Remove Trust — It Engineers It", price: 0.0007, url: '' },
  { workId: 'k2', title: 'Why Private DeFi Is the Use Case That Matters', price: 0.0008, url: '' },
  { workId: 'k3', title: 'The Original Mesh Network: Pigeon Post & Sovereign Data', price: 0.0006, url: '' },
  { workId: 'k4', title: 'Why You Should Use a Concrete Vault', price: 0.0005, url: '' },
];

async function main() {
  console.log(`Syncing ${KNOWN_WORKS.length} known works to backend content index at ${API_URL}...`);
  console.log('');

  for (const work of KNOWN_WORKS) {
    try {
      const res = await fetch(`${API_URL}/api/register-work`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workId: work.workId,
          title: work.title,
          url: work.url,
          usdcUnits: work.price,
          wallet: AGENT_ADDRESS,
          recipients: [AGENT_ADDRESS],
          bps: [10000],
        }),
      });
      console.log(`  ${res.ok ? '✓' : '✗'} ${work.workId}: "${work.title}" — ${res.ok ? 'synced' : `failed (${res.status})`}`);
    } catch (e) {
      console.log(`  ✗ ${work.workId}: backend unreachable — ${e.message}`);
    }
  }

  console.log('');
  console.log('Done. Check data/corpus.json or restart the backend to confirm.');
}

main();