// scripts/proof.js
// ---------------------------------------------------------------------------
// Read-only proof-of-settlement report. Connects to Arc testnet, reads every
// real settlement straight off the deployed KeryxSplits v2 contract, and
// prints a clean summary: total settled, per-recipient breakdown, and every
// individual transaction. Nothing here is generated or simulated; it is the
// exact same on-chain data the Explorer tab reads, formatted for a terminal
// so it can be run live during a demo as independent proof.
//
// v2 note: a single citation can now credit multiple recipients (co-author
// splits), so CitationSettled (reader + timestamp) and RecipientCredited
// (who was actually paid, how much) are two separate events, joined here
// by transaction hash.
//
// Usage:
//   node scripts/proof.js
// ---------------------------------------------------------------------------

import 'dotenv/config';
import { createPublicClient, http, formatUnits } from 'viem';

const RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042002);
const CONTRACT_ADDRESS = process.env.KERYX_CONTRACT_ADDRESS;
const EXPLORER = process.env.ARC_EXPLORER_URL || 'https://testnet.arcscan.app';
const DEPLOY_BLOCK = BigInt(process.env.KERYX_DEPLOY_BLOCK || '49746900');
const MAX_RANGE = 9500n; // stay under Arc RPC's 10,000-block eth_getLogs cap

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

const short = (a) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '(unknown)');

async function scanLogs(client, event, fromBlock) {
  const latest = await client.getBlockNumber();
  const all = [];
  let from = fromBlock;
  while (from <= latest) {
    const to = from + MAX_RANGE > latest ? latest : from + MAX_RANGE;
    const chunk = await client.getLogs({ address: CONTRACT_ADDRESS, event, fromBlock: from, toBlock: to });
    all.push(...chunk);
    from = to + 1n;
  }
  return all;
}

async function main() {
  if (!CONTRACT_ADDRESS) {
    console.error('KERYX_CONTRACT_ADDRESS not set in .env');
    process.exit(1);
  }

  const client = createPublicClient({
    chain: { id: CHAIN_ID, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } },
    transport: http(RPC_URL),
  });

  console.log(`Reading settlements from ${CONTRACT_ADDRESS} on Arc testnet...`);
  console.log('');

  const [citationLogs, recipientLogs] = await Promise.all([
    scanLogs(client, CITATION_SETTLED_EVENT, DEPLOY_BLOCK),
    scanLogs(client, RECIPIENT_CREDITED_EVENT, DEPLOY_BLOCK),
  ]);

  if (recipientLogs.length === 0) {
    console.log('No settlements found yet.');
    return;
  }

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
      reader: meta.reader,
      amount: Number(formatUnits(l.args.amount, 6)),
      timestamp: meta.timestamp || 0,
      txHash: l.transactionHash,
    };
  }).sort((a, b) => b.timestamp - a.timestamp);

  const totalSettled = rows.reduce((sum, r) => sum + r.amount, 0);
  const byRecipient = {};
  for (const r of rows) {
    byRecipient[r.recipient] = (byRecipient[r.recipient] || 0) + r.amount;
  }

  console.log(`Total settlements: ${rows.length}`);
  console.log(`Total USDC paid:   ${totalSettled.toFixed(6)}`);
  console.log('');
  console.log('Per-recipient earnings:');
  for (const [recipient, amount] of Object.entries(byRecipient)) {
    console.log(`  ${short(recipient)}  →  ${amount.toFixed(6)} USDC`);
  }
  console.log('');
  console.log('Individual settlements (newest first):');
  for (const r of rows) {
    const when = r.timestamp ? new Date(r.timestamp).toISOString() : '(pending)';
    console.log(`  ${when}  ${short(r.recipient)} paid ${r.amount.toFixed(6)} USDC by ${short(r.reader)}`);
    console.log(`    ${EXPLORER}/tx/${r.txHash}`);
  }
}

main().catch((e) => {
  console.error('Failed to read settlement proof:', e.message);
  process.exit(1);
});