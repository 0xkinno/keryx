// scripts/fund-gateway.js
// ---------------------------------------------------------------------------
// ONE-TIME SETUP — deposits testnet USDC into your agent wallet's Circle
// Gateway balance, so it can make gasless x402 nanopayments. This version
// is corrected against Circle's own verified buyer quickstart
// (developers.circle.com/gateway/nanopayments/quickstarts/buyer), using the
// real @circle-fin/x402-batching package. An earlier attempt used the wrong
// package (@circle-fin/app-kit) and failed — this one uses GatewayClient,
// confirmed directly from Circle's own documented example.
//
// Install first:
//   npm install @circle-fin/x402-batching viem
//
// Prerequisites:
//   - AGENT_PRIVATE_KEY in .env, for an EOA wallet (not a smart contract
//     wallet — Gateway verifies signatures with ecrecover, which SCA
//     wallets don't support).
//   - That wallet must already hold some testnet USDC to deposit. Get it
//     from https://faucet.circle.com if it doesn't.
//   - Testnet native gas token for the one-time deposit transaction itself.
//
// Usage:
//   node scripts/fund-gateway.js [amount]
//   node scripts/fund-gateway.js 5      (deposits 5 USDC instead of the default 1)
// ---------------------------------------------------------------------------

import 'dotenv/config';
import { GatewayClient } from '@circle-fin/x402-batching/client';

const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
const amountArg = process.argv[2];
const DEPOSIT_AMOUNT = amountArg || '1'; // whole USDC, e.g. "1" = 1.00 USDC

async function main() {
  if (!PRIVATE_KEY) throw new Error('AGENT_PRIVATE_KEY not set in .env');

  const client = new GatewayClient({
    chain: 'arcTestnet',
    privateKey: PRIVATE_KEY,
  });

  console.log('Checking current balances...');
  const before = await client.getBalances();
  console.log(`  Wallet USDC:        ${before.wallet.formatted}`);
  console.log(`  Gateway available:  ${before.gateway.formattedAvailable}`);
  console.log('');

  const depositUnits = BigInt(Math.round(Number(DEPOSIT_AMOUNT) * 1_000_000)); // 6 decimals

  if (before.gateway.available >= depositUnits) {
    console.log(`Gateway balance already has at least ${DEPOSIT_AMOUNT} USDC available. Nothing to do.`);
    return;
  }

  console.log(`Depositing ${DEPOSIT_AMOUNT} USDC into Gateway...`);
  const deposit = await client.deposit(DEPOSIT_AMOUNT);
  console.log(`Deposit tx: ${deposit.depositTxHash}`);
  console.log('');

  console.log('Checking updated balances...');
  const after = await client.getBalances();
  console.log(`  Wallet USDC:        ${after.wallet.formatted}`);
  console.log(`  Gateway available:  ${after.gateway.formattedAvailable}`);
  console.log('');
  console.log('Done. Your agent wallet can now make gasless x402 nanopayments via Circle Gateway.');
}

main().catch((e) => {
  console.error('Gateway funding failed:', e.message);
  process.exit(1);
});