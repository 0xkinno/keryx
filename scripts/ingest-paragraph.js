// scripts/ingest-paragraph.js
// ---------------------------------------------------------------------------
// Pulls REAL published articles from Paragraph's public API — a live,
// wallet-native Web3 publishing platform (the successor to Mirror.xyz,
// which is shutting down as of late 2025) — and adds them to KERYX's
// local content index so the agent can genuinely read, judge relevance,
// and cite them in real answers.
//
// IMPORTANT — what this does NOT do: it does not register anything on the
// KeryxSplits contract. Real on-chain registration requires the actual
// author's own wallet signature (the contract enforces this), and this
// script has no way to sign on someone else's behalf, nor should it.
// These articles become CITABLE — the agent can quote them with correct
// attribution to a real, verified wallet address — but not yet PAYABLE,
// until that real author connects their wallet and registers themselves
// through the app.
//
// Endpoint verified directly against Paragraph's own published OpenAPI
// spec (paragraph.com/docs/api-reference/discover/search-posts.md).
// No API key required — this is an unauthenticated public endpoint.
//
// Usage:
//   node scripts/ingest-paragraph.js "DeFi privacy"
//   node scripts/ingest-paragraph.js "on-chain trust"
// ---------------------------------------------------------------------------

import 'dotenv/config';

const API_BASE = 'https://public.api.paragraph.com/api';
const API_URL = process.env.API_URL || 'http://localhost:4000';

const query = process.argv[2];
if (!query) {
  console.error('Usage: node scripts/ingest-paragraph.js "<search query>"');
  console.error('Example: node scripts/ingest-paragraph.js "DeFi privacy"');
  process.exit(1);
}

async function searchParagraph(q) {
  const url = `${API_BASE}/v1/discover/search?q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Paragraph API returned ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  console.log(`Searching Paragraph for: "${query}"...`);
  const results = await searchParagraph(query);

  if (!Array.isArray(results) || results.length === 0) {
    console.log('No results found. Try a different query.');
    return;
  }

  console.log(`Found ${results.length} result(s).`);
  console.log('');

  let indexed = 0;
  let noWallet = 0;

  for (const r of results) {
    const post = r.post;
    const user = r.user;
    const blog = r.blog;

    if (!post?.title) {
      console.log(`  · skipped (no title): postId ${post?.postId || 'unknown'}`);
      continue;
    }

    if (!user?.walletAddress) {
      // Real content, but the author has no wallet on file — can't attribute
      // it to a payable identity, so we skip it rather than guess.
      console.log(`  · skipped (no wallet on file): "${post.title}"`);
      noWallet += 1;
      continue;
    }

    const url = blog?.slug && post.slug
      ? `https://paragraph.com/@${blog.slug}/${post.slug}`
      : `https://paragraph.com/p/${post.postId}`;

    const workId = `paragraph_${post.postId}`;

    try {
      const res = await fetch(`${API_URL}/api/register-work`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workId,
          title: post.title,
          url,
          usdcUnits: 0.0007, // default price — not payable until the real author registers on-chain themselves
          wallet: user.walletAddress,
          recipients: [user.walletAddress],
          bps: [10000],
        }),
      });
      if (res.ok) {
        console.log(`  ✓ indexed: "${post.title}" — by ${user.name || 'unknown'} (${user.walletAddress})`);
        indexed += 1;
      } else {
        console.log(`  ✗ backend rejected "${post.title}" (${res.status})`);
      }
    } catch (e) {
      console.log(`  ✗ backend unreachable for "${post.title}": ${e.message}`);
    }
  }

  console.log('');
  console.log(`Done. Indexed ${indexed} article(s) for citation. Skipped ${noWallet} with no wallet on file.`);
  console.log('These are now citable by the agent, but NOT payable on-chain until their');
  console.log('real authors connect the matching wallet and register themselves in the app.');
}

main().catch((e) => {
  console.error('Ingest failed:', e.message);
  process.exit(1);
});