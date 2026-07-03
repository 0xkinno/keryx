// scripts/register-seed.js
// ---------------------------------------------------------------------------
// Registers the seeded k1-k4 works on the deployed KeryxSplits v3 contract,
// entirely from the terminal — no Remix needed. Title and URL are now
// stored fully on-chain, so once this script confirms, every wallet can
// discover these works directly from the contract with no backend index
// required at all.
//
// A best-effort backend sync still happens afterward, purely so the agent
// has real article text to quote from when it cites these works — that is
// a content-quality step only, not required for discovery, buying, or
// getting paid.
//
// Usage:
//   node scripts/register-seed.js
// ---------------------------------------------------------------------------

import 'dotenv/config';
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042002);
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.KERYX_CONTRACT_ADDRESS;
const API_URL = process.env.API_URL || 'http://localhost:4000';

const KERYX_ABI = [
  {
    type: 'function', name: 'registerWork', stateMutability: 'nonpayable',
    inputs: [
      { name: 'workId', type: 'string' },
      { name: 'title', type: 'string' },
      { name: 'url', type: 'string' },
      { name: 'recipients', type: 'address[]' },
      { name: 'bps', type: 'uint16[]' },
      { name: 'pricePerCitation', type: 'uint256' },
    ],
    outputs: [],
  },
];

const SEED_WORKS = [
  { workId: 'k1', title: "DeFi Doesn't Remove Trust — It Engineers It", price: '0.0007', url: '' },
  { workId: 'k2', title: 'Why Private DeFi Is the Use Case That Matters', price: '0.0008', url: '' },
  { workId: 'k3', title: 'The Original Mesh Network: Pigeon Post & Sovereign Data', price: '0.0006', url: '' },
  { workId: 'k4', title: 'Why You Should Use a Concrete Vault', price: '0.0005', url: '' },
];

async function syncContentToBackend(work, wallet, recipients, bps) {
  try {
    const res = await fetch(`${API_URL}/api/register-work`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workId: work.workId,
        title: work.title,
        url: work.url,
        usdcUnits: Number(work.price),
        wallet,
        recipients,
        bps,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (!PRIVATE_KEY) throw new Error('AGENT_PRIVATE_KEY not set in .env');
  if (!CONTRACT_ADDRESS) throw new Error('KERYX_CONTRACT_ADDRESS not set in .env');

  const account = privateKeyToAccount(PRIVATE_KEY);

  const chain = {
    id: CHAIN_ID,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  };

  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });

  console.log(`Registering ${SEED_WORKS.length} works on ${CONTRACT_ADDRESS}`);
  console.log(`As recipient: ${account.address}`);
  console.log('');

  for (const work of SEED_WORKS) {
    const priceUnits = parseUnits(work.price, 6);
    console.log(`Registering ${work.workId}: "${work.title}" at $${work.price}...`);
    try {
      const hash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS,
        abi: KERYX_ABI,
        functionName: 'registerWork',
        args: [work.workId, work.title, work.url, [account.address], [10000], priceUnits],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ✓ on-chain confirmed — ${receipt.transactionHash}`);
      console.log(`    (title and price are now readable by any wallet directly from the contract)`);

      const synced = await syncContentToBackend(work, account.address, [account.address], [10000]);
      console.log(`  ${synced ? '✓' : '·'} content index ${synced ? 'updated' : 'skipped (backend offline — fine, on-chain registration already stands)'}`);
    } catch (e) {
      console.log(`  ✗ failed — ${e.message?.slice(0, 100)}`);
    }
  }

  console.log('');
  console.log('Done. Verify in the app\'s Explorer tab or via scripts/proof.js.');
}

main().catch((e) => {
  console.error('Registration script failed:', e.message);
  process.exit(1);
});