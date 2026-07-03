// scripts/one-payout.js
// ---------------------------------------------------------------------------
// THE THESIS, PROVEN IN ONE TRANSACTION.
//
// Sends a single sub-cent USDC payment from the KERYX agent wallet to a writer
// wallet on Arc testnet, and prints the verifiable transaction hash. This is the
// smallest possible proof that the whole idea works: a citation worth a fraction
// of a cent, settled on-chain, gas paid in USDC.
//
//   Run:  node scripts/one-payout.js
//   Env:  AGENT_PRIVATE_KEY, WRITER_ADDRESS, USDC_ADDRESS, ARC_RPC_URL, ARC_CHAIN_ID
// ---------------------------------------------------------------------------

import 'dotenv/config';
import { agentWallet, publicClient, explorerTx } from '../src/chain/arc.js';
import { transfer, balanceOf, fmtUsdc, usdc } from '../src/chain/usdc.js';

const WRITER = process.env.WRITER_ADDRESS;
const AMOUNT = process.env.PAYOUT_AMOUNT || '0.0005'; // sub-cent citation fee

async function main() {
  if (!WRITER) throw new Error('Set WRITER_ADDRESS in .env');

  const { account, client } = agentWallet();
  const amountUnits = usdc(AMOUNT);

  console.log('— KERYX · one real payout ——————————————————————————');
  console.log('agent  :', account.address);
  console.log('writer :', WRITER);
  console.log('amount :', AMOUNT, 'USDC', `(${amountUnits} base units)`);

  const before = await balanceOf(account.address);
  console.log('agent balance before:', fmtUsdc(before), 'USDC');
  if (before < amountUnits) {
    throw new Error('Agent wallet underfunded — get test USDC from the Arc faucet / TestMint.');
  }

  const hash = await transfer(client, WRITER, amountUnits);
  console.log('\nsubmitted:', hash);
  console.log('waiting for confirmation…');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const writerBal = await balanceOf(WRITER);

  console.log('\n✓ settled in block', receipt.blockNumber.toString(), '·', receipt.status);
  console.log('  writer balance now:', fmtUsdc(writerBal), 'USDC');
  console.log('  receipt:', explorerTx(hash));
  console.log('————————————————————————————————————————————————————');
  console.log('That hash is the entire pitch. A writer just got paid for a citation.');
}

main().catch((e) => {
  console.error('payout failed:', e.shortMessage || e.message);
  process.exit(1);
});
