// src/circle/x402.js
// ---------------------------------------------------------------------------
// x402 via Circle Gateway Nanopayments — REWRITTEN against Circle's actual
// official package, verified directly from developers.circle.com on
// 2026-07-03. The previous version of this file used community reference
// packages (x402-express / x402-fetch), which are spec-compliant but are
// NOT what Circle documents for Arc + Gateway. The correct, first-party
// package is @circle-fin/x402-batching.
//
// Install:
//   npm install @circle-fin/x402-batching viem
//
// Two halves:
//   1. settleX402Request()  — protects the publisher's /content/:workId
//      route with a per-work price. Uses BatchFacilitatorClient directly
//      (not the simpler createGatewayMiddleware wrapper) because KERYX
//      needs a DIFFERENT price per work, not one fixed price per route.
//   2. fetchPaidSource()    — the agent's paying client. Uses GatewayClient,
//      which handles the full 402 negotiation (request → 402 → sign →
//      retry → 200) automatically in one call.
//
// PREREQUISITE, confirmed from Circle's own buyer quickstart: the agent
// wallet must deposit USDC into its Gateway Wallet balance once, onchain,
// before any payment can settle. Run scripts/fund-gateway.js once. This is
// a real requirement, not optional — Nanopayments spends FROM that Gateway
// balance, not directly from the wallet's plain USDC balance.
// ---------------------------------------------------------------------------

import 'dotenv/config';
import { BatchFacilitatorClient } from '@circle-fin/x402-batching/server';
import { GatewayClient } from '@circle-fin/x402-batching/client';
import { formatUnits, parseUnits } from 'viem';

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://gateway-api-testnet.circle.com';
const NETWORK = process.env.X402_NETWORK || 'eip155:5042002'; // Arc Testnet, CAIP-2
const PUBLISHER_ADDRESS = process.env.PUBLISHER_ADDRESS;
const USDC_ADDRESS = process.env.USDC_ADDRESS;
// Gateway Wallet contract on Arc Testnet — confirm against
// developers.circle.com/gateway/references/supported-blockchains if this
// changes; Circle's docs point to the same address used across EVM testnets.
const GATEWAY_WALLET_CONTRACT = process.env.GATEWAY_WALLET_CONTRACT || '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';

const facilitator = new BatchFacilitatorClient({ url: FACILITATOR_URL });

/**
 * Build the 402 payment-required payload for a specific work, at that
 * work's own price (not a fixed route-wide price).
 */
function buildPaymentRequirements({ workId, priceUsdc, resourceUrl, payTo }) {
  const amountUnits = parseUnits(priceUsdc.toString(), 6).toString();
  return {
    scheme: 'exact',
    network: NETWORK,
    asset: USDC_ADDRESS,
    amount: amountUnits,
    maxTimeoutSeconds: 604900, // Gateway requires > 7 days validity on the signature
    payTo: payTo || PUBLISHER_ADDRESS,
    extra: {
      name: 'GatewayWalletBatched',
      version: '1',
      verifyingContract: GATEWAY_WALLET_CONTRACT,
    },
    resource: { url: resourceUrl, description: `KERYX work ${workId}`, mimeType: 'text/plain' },
  };
}

/**
 * Express-style handler for GET /content/:workId. Call this from the route
 * instead of returning content directly. Returns true if the request was
 * handled here (either a 402 was sent, or payment was verified and the
 * caller should proceed to serve the content). Returns false only on a
 * hard configuration error.
 *
 * Usage in server.js:
 *   app.get('/content/:workId', async (req, res) => {
 *     const work = loadCorpus().find(w => w.id === req.params.workId);
 *     if (!work) return res.status(404).json({ error: 'unknown work' });
 *     const paid = await settleX402Request(req, res, {
 *       workId: work.id, priceUsdc: work.price, resourceUrl: req.originalUrl,
 *     });
 *     if (!paid) return; // settleX402Request already sent the 402 response
 *     res.type('text/plain').send((work.chunks || []).join('\n'));
 *   });
 */
export async function settleX402Request(req, res, { workId, priceUsdc, resourceUrl, payTo }) {
  if (!PUBLISHER_ADDRESS) throw new Error('PUBLISHER_ADDRESS not set');
  if (!USDC_ADDRESS) throw new Error('USDC_ADDRESS not set');

  const requirements = buildPaymentRequirements({ workId, priceUsdc, resourceUrl, payTo });
  const paymentSignature = req.header('PAYMENT-SIGNATURE');

  if (!paymentSignature) {
    const paymentRequired = {
      x402Version: 2,
      resource: requirements.resource,
      accepts: [requirements],
    };
    res.status(402).set(
      'PAYMENT-REQUIRED',
      Buffer.from(JSON.stringify(paymentRequired)).toString('base64')
    ).json({ error: 'payment required' });
    return false;
  }

  const payload = JSON.parse(Buffer.from(paymentSignature, 'base64').toString('utf8'));
  const settlement = await facilitator.settle(payload, requirements);

  if (!settlement.success) {
    res.status(402).json({ error: 'settlement failed', detail: settlement });
    return false;
  }

  res.set(
    'PAYMENT-RESPONSE',
    Buffer.from(JSON.stringify({
      verified: true,
      payer: settlement.payer,
      amount: settlement.amount,
      network: NETWORK,
      transaction: settlement.transaction,
    })).toString('base64')
  );
  return true;
}

/**
 * The agent's paying client. Handles the full 402 negotiation in one call:
 * requests the URL, receives 402, signs an EIP-3009 authorization offchain
 * (zero gas), retries with the payment signature, returns the resource.
 *
 * Requires the agent wallet's Gateway balance to already be funded — run
 * scripts/fund-gateway.js once before this will succeed.
 */
export async function fetchPaidSource(url) {
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  if (!privateKey) throw new Error('AGENT_PRIVATE_KEY not set');

  const client = new GatewayClient({ chain: 'arcTestnet', privateKey });

  const support = await client.supports(url);
  if (!support.supported) {
    throw new Error(`${url} does not support Gateway/x402 payments`);
  }

  const { data, status } = await client.pay(url);
  if (status !== 200) {
    throw new Error(`x402 payment to ${url} failed with status ${status}`);
  }

  return {
    text: typeof data === 'string' ? data : JSON.stringify(data),
    paid: true,
    tx: null, // GatewayClient.pay() does not currently surface the settlement tx hash directly in its return value
  };
}

/**
 * Check the agent's current Gateway balance — useful for a quick sanity
 * check before running a demo, without needing the full deposit script.
 */
export async function getAgentGatewayBalance() {
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  if (!privateKey) throw new Error('AGENT_PRIVATE_KEY not set');
  const client = new GatewayClient({ chain: 'arcTestnet', privateKey });
  const balances = await client.getBalances();
  return {
    wallet: balances.wallet.formatted,
    gatewayAvailable: balances.gateway.formattedAvailable,
  };
}