// scripts/ingest-medium.js
// ---------------------------------------------------------------------------
// Pulls real published articles from a Medium profile's public RSS feed
// into KERYX's content index. Confirmed real, standard format directly from
// Medium's own help documentation: https://medium.com/feed/@username
//
// IMPORTANT — honest limitation: unlike Paragraph, Medium has no wallet
// concept anywhere in its platform. There is no real author wallet to pull
// automatically. This script indexes real article TEXT for the agent to
// cite from, but every imported article needs a wallet manually assigned
// before it can ever be paid — either edit WALLET_FOR_IMPORTS below, or
// leave it unset and these entries will be citable-but-unattributed until
// someone claims them through the app's own Register flow.
//
// No API key required — Medium's RSS feeds are fully public.
//
// Usage:
//   node scripts/ingest-medium.js <medium-username>
//   node scripts/ingest-medium.js 0xkinno
// ---------------------------------------------------------------------------

import 'dotenv/config';

const API_URL = process.env.API_URL || 'http://localhost:4000';

// If you want imported articles to be immediately attributable to a real
// wallet (e.g. your own Medium articles), set this. Otherwise leave null —
// the articles still get indexed for the agent to read, just without a
// payable wallet until someone registers it properly through the app.
const WALLET_FOR_IMPORTS = process.env.MEDIUM_IMPORT_WALLET || null;

const username = process.argv[2];
if (!username) {
  console.error('Usage: node scripts/ingest-medium.js <medium-username>');
  console.error('Example: node scripts/ingest-medium.js 0xkinno');
  process.exit(1);
}

const cleanUsername = username.replace(/^@/, '');
const feedUrl = `https://medium.com/feed/@${cleanUsername}`;

/**
 * Minimal, dependency-free RSS <item> extractor. Medium's feed format is
 * consistent standard RSS 2.0, so a targeted regex per field is reliable
 * here without pulling in a full XML parser dependency.
 */
function parseItems(xml) {
  const items = [];
  const itemBlocks = xml.split('<item>').slice(1); // first chunk is feed header, skip it

  for (const block of itemBlocks) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const creatorMatch = block.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/);
    const contentMatch = block.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/);

    if (!titleMatch || !linkMatch) continue;

    const title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const link = linkMatch[1].trim();
    const creator = creatorMatch ? creatorMatch[1].trim() : cleanUsername;
    // Strip HTML tags from content for a plain-text snippet the agent can read.
    const rawContent = contentMatch ? contentMatch[1] : '';
    const plainText = rawContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    items.push({ title, link, creator, content: plainText });
  }

  return items;
}

async function main() {
  console.log(`Fetching Medium feed for @${cleanUsername}...`);
  const res = await fetch(feedUrl);
  if (!res.ok) {
    throw new Error(`Medium returned ${res.status} — check the username is correct and public`);
  }
  const xml = await res.text();
  const items = parseItems(xml);

  if (items.length === 0) {
    console.log('No articles found in this feed.');
    return;
  }

  console.log(`Found ${items.length} article(s).`);
  if (!WALLET_FOR_IMPORTS) {
    console.log('No MEDIUM_IMPORT_WALLET set — these will be indexed as citable content');
    console.log('only, with no payable wallet attached yet.');
  }
  console.log('');

  let indexed = 0;

  for (const item of items) {
    const workId = `medium_${cleanUsername}_${Buffer.from(item.link).toString('base64').slice(0, 16)}`;

    try {
      const res = await fetch(`${API_URL}/api/register-work`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workId,
          title: item.title,
          url: item.link,
          usdcUnits: 0.0007,
          wallet: WALLET_FOR_IMPORTS || '',
          recipients: WALLET_FOR_IMPORTS ? [WALLET_FOR_IMPORTS] : [],
          bps: WALLET_FOR_IMPORTS ? [10000] : [],
        }),
      });
      if (res.ok) {
        console.log(`  ✓ indexed: "${item.title}"`);
        indexed += 1;
      } else {
        console.log(`  ✗ backend rejected "${item.title}" (${res.status})`);
      }
    } catch (e) {
      console.log(`  ✗ backend unreachable for "${item.title}": ${e.message}`);
    }
  }

  console.log('');
  console.log(`Done. Indexed ${indexed}/${items.length} article(s).`);
  if (!WALLET_FOR_IMPORTS) {
    console.log('Remember: these are citable but not yet payable — no wallet is attached.');
    console.log('Set MEDIUM_IMPORT_WALLET in .env and re-run to attribute them to a real wallet.');
  }
}

main().catch((e) => {
  console.error('Medium ingest failed:', e.message);
  process.exit(1);
});