// scripts/diagnose.js
// ---------------------------------------------------------------------------
// Directly queries the deployed contract's on-chain catalog — bypasses the
// app UI entirely. Prints exactly what the contract itself believes exists,
// so we know for certain whether this is a write problem or a read problem.
//
// Usage:
//   node scripts/diagnose.js
// ---------------------------------------------------------------------------

import 'dotenv/config';
import { createPublicClient, http } from 'viem';

const RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042002);
const CONTRACT_ADDRESS = process.env.KERYX_CONTRACT_ADDRESS;

const ABI = [
  { type: 'function', name: 'workCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getWorkIdsPage', stateMutability: 'view',
    inputs: [{ name: 'offset', type: 'uint256' }, { name: 'limit', type: 'uint256' }],
    outputs: [{ type: 'string[]' }] },
  { type: 'function', name: 'getWork', stateMutability: 'view',
    inputs: [{ name: 'workId', type: 'string' }],
    outputs: [
      { name: 'title', type: 'string' },
      { name: 'url', type: 'string' },
      { name: 'recipients', type: 'address[]' },
      { name: 'bps', type: 'uint16[]' },
      { name: 'price', type: 'uint256' },
      { name: 'citationCount', type: 'uint256' },
      { name: 'exists', type: 'bool' },
    ] },
];

async function main() {
  if (!CONTRACT_ADDRESS) throw new Error('KERYX_CONTRACT_ADDRESS not set in .env');

  const client = createPublicClient({
    chain: { id: CHAIN_ID, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } },
    transport: http(RPC_URL),
  });

  console.log(`Reading directly from ${CONTRACT_ADDRESS}`);
  console.log('');

  const count = await client.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'workCount' });
  console.log(`workCount() says: ${count} works registered on this contract`);
  console.log('');

  if (Number(count) === 0) {
    console.log('The contract genuinely has zero works. Nothing to enumerate.');
    return;
  }

  const ids = await client.readContract({
    address: CONTRACT_ADDRESS, abi: ABI, functionName: 'getWorkIdsPage',
    args: [0n, count],
  });
  console.log(`getWorkIdsPage(0, ${count}) returned these raw workIds:`);
  ids.forEach((id, i) => console.log(`  [${i}] "${id}"`));
  console.log('');

  console.log('Fetching full details for each:');
  for (const id of ids) {
    try {
      const [title, url, recipients, bps, price, citationCount, exists] = await client.readContract({
        address: CONTRACT_ADDRESS, abi: ABI, functionName: 'getWork', args: [id],
      });
      console.log(`  "${id}" → exists=${exists}, title="${title}", price=${price}, recipients=${recipients.length}`);
    } catch (e) {
      console.log(`  "${id}" → getWork() THREW AN ERROR: ${e.message?.slice(0, 150)}`);
    }
  }
}

main().catch((e) => {
  console.error('Diagnosis failed:', e.message);
  process.exit(1);
});