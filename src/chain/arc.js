// src/chain/arc.js
// Arc testnet chain definition + viem clients.
//
// CONFIRM against the ARC CLI output / docs.arc.network:
//   - ARC_RPC_URL        (the Canteen-hosted Arc testnet RPC from the ARC CLI)
//   - ARC_CHAIN_ID       (5042002 observed on Arc Testnet; verify for your network)
//   - ARC_EXPLORER_URL   (block explorer base, for receipt links)
// USDC is the native gas token on Arc, so gas is paid in USDC.

import 'dotenv/config';
import { createPublicClient, createWalletClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_URL = process.env.ARC_RPC_URL;
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042002);
const EXPLORER = process.env.ARC_EXPLORER_URL || '';

if (!RPC_URL) {
  console.warn('[arc] ARC_RPC_URL is not set — fill it from the ARC CLI / docs.arc.network');
}

export const arcTestnet = defineChain({
  id: CHAIN_ID,
  name: 'Arc Testnet',
  // Arc pays gas in USDC (6 decimals).
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: [RPC_URL || ''] } },
  blockExplorers: EXPLORER ? { default: { name: 'Arc Explorer', url: EXPLORER } } : undefined,
  testnet: true,
});

/** Read-only client for queries, logs, and receipts. */
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(RPC_URL),
});

/** Build a wallet client from a private key (the agent or a writer). */
export function walletFromKey(privateKey) {
  const key = privateKey?.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(key);
  const client = createWalletClient({ account, chain: arcTestnet, transport: http(RPC_URL) });
  return { account, client };
}

/** The KERYX agent wallet (pays tolls, settles citations). */
export function agentWallet() {
  if (!process.env.AGENT_PRIVATE_KEY) throw new Error('AGENT_PRIVATE_KEY not set');
  return walletFromKey(process.env.AGENT_PRIVATE_KEY);
}

export function explorerTx(hash) {
  return EXPLORER ? `${EXPLORER.replace(/\/$/, '')}/tx/${hash}` : hash;
}
