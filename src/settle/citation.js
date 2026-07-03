// src/settle/citation.js
// ---------------------------------------------------------------------------
// Settle citations through the deployed KeryxSplits v3 contract.
//
// Model: the READER approves KeryxSplits to spend a small USDC allowance
// (frontend's ApprovalModal, once per session). The AGENT wallet then calls
// settleAnswer(workIds, reader, amounts) ONCE per answer — a single
// transaction that settles every citation in that answer in one shot, each
// split across that work's registered recipients by basis points. The agent
// never spends its own USDC; it only triggers the pull, which the contract
// enforces via the onlyAgent modifier.
//
// v3 note: getWork() now also returns title and url, since the full work
// catalog (not just price/recipients) lives entirely on-chain. This module
// only needs price/recipients for settlement, so those two extra fields are
// read but not otherwise used here.
//
// Work IDs are plain strings ("k1", "k2", ...). Every amount that leaves
// this module is a human-readable decimal STRING (via formatUnits), never
// a raw BigInt — BigInt cannot be JSON.stringify'd and would crash the SSE
// stream if it reached server.js unconverted.
// ---------------------------------------------------------------------------

import 'dotenv/config';
import { formatUnits } from 'viem';
import { agentWallet, publicClient, explorerTx } from '../chain/arc.js';

export const CONTRACT_ADDRESS = process.env.KERYX_CONTRACT_ADDRESS;
const USDC_DECIMALS = 6;

export const keryxAbi = [
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
  {
    type: 'function', name: 'updatePrice', stateMutability: 'nonpayable',
    inputs: [
      { name: 'workId', type: 'string' },
      { name: 'newPrice', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'settleCitation', stateMutability: 'nonpayable',
    inputs: [
      { name: 'workId', type: 'string' },
      { name: 'reader', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'settleAnswer', stateMutability: 'nonpayable',
    inputs: [
      { name: 'workIds', type: 'string[]' },
      { name: 'reader', type: 'address' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'withdraw', stateMutability: 'nonpayable',
    inputs: [], outputs: [],
  },
  {
    type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'writer', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'citationsOf', stateMutability: 'view',
    inputs: [{ name: 'workId', type: 'string' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'workCount', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'getWorkIdsPage', stateMutability: 'view',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [{ type: 'string[]' }],
  },
  {
    type: 'function', name: 'getWork', stateMutability: 'view',
    inputs: [{ name: 'workId', type: 'string' }],
    outputs: [
      { name: 'title', type: 'string' },
      { name: 'url', type: 'string' },
      { name: 'recipients', type: 'address[]' },
      { name: 'bps', type: 'uint16[]' },
      { name: 'price', type: 'uint256' },
      { name: 'citationCount', type: 'uint256' },
      { name: 'exists', type: 'bool' },
    ],
  },
  {
    type: 'event', name: 'WorkRegistered',
    inputs: [
      { name: 'workId', type: 'string', indexed: true },
      { name: 'title', type: 'string', indexed: false },
      { name: 'url', type: 'string', indexed: false },
      { name: 'recipients', type: 'address[]', indexed: false },
      { name: 'bps', type: 'uint16[]', indexed: false },
      { name: 'price', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'PriceUpdated',
    inputs: [
      { name: 'workId', type: 'string', indexed: true },
      { name: 'oldPrice', type: 'uint256', indexed: false },
      { name: 'newPrice', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'CitationSettled',
    inputs: [
      { name: 'workId', type: 'string', indexed: true },
      { name: 'reader', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'RecipientCredited',
    inputs: [
      { name: 'workId', type: 'string', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'AnswerSettled',
    inputs: [
      { name: 'reader', type: 'address', indexed: true },
      { name: 'workCount', type: 'uint256', indexed: false },
      { name: 'totalAmount', type: 'uint256', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Withdrawn',
    inputs: [
      { name: 'writer', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
];

/**
 * Read a work's registered price and recipient list straight from the contract.
 * Throws if the work isn't registered.
 */
export async function getWorkOnchain(workId) {
  if (!CONTRACT_ADDRESS) throw new Error('KERYX_CONTRACT_ADDRESS not set');
  const [title, url, recipients, bps, price, citationCount, exists] = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: keryxAbi,
    functionName: 'getWork',
    args: [workId],
  });
  if (!exists) throw new Error(`Work "${workId}" is not registered on-chain`);
  return { title, url, recipients, bps, price, citationCount };
}

/**
 * Settle every citation for one answer in a SINGLE transaction. Splits are
 * applied on-chain per each work's registered recipients/bps automatically.
 *
 * citations: [{ workId, contributionPct }]
 * Returns: { results: [{ workId, amount, contributionPct, hash, receiptUrl }], count, hash, receiptUrl }
 * — every `amount` is a decimal string, safe to JSON.stringify. All results
 * share the same hash/receiptUrl since they settled in one transaction.
 */
export async function settleAnswerOnchain({ reader, citations }) {
  if (!CONTRACT_ADDRESS) throw new Error('KERYX_CONTRACT_ADDRESS not set');
  if (!reader) throw new Error('settleAnswerOnchain: reader address is required');
  if (!citations || citations.length === 0) throw new Error('settleAnswerOnchain: no citations to settle');

  const { client } = agentWallet();

  const workIds = citations.map((c) => c.workId);
  const prices = [];
  for (const id of workIds) {
    const w = await getWorkOnchain(id);
    prices.push(w.price); // BigInt, raw 6-decimal units
  }

  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    abi: keryxAbi,
    functionName: 'settleAnswer',
    args: [workIds, reader, prices],
  });
  await publicClient.waitForTransactionReceipt({ hash });

  const receiptUrl = explorerTx(hash);
  const results = citations.map((c, i) => ({
    workId: c.workId,
    amount: formatUnits(prices[i], USDC_DECIMALS),
    contributionPct: c.contributionPct,
    hash,
    receiptUrl,
  }));

  return { results, count: results.length, hash, receiptUrl };
}

/**
 * Settle a single citation on its own (used outside the main answer flow,
 * e.g. a manual re-settlement). Prefer settleAnswerOnchain for normal use.
 */
export async function settleCitationOnchain({ workId, reader }) {
  if (!CONTRACT_ADDRESS) throw new Error('KERYX_CONTRACT_ADDRESS not set');
  if (!reader) throw new Error('settleCitationOnchain: reader address is required');

  const { client } = agentWallet();
  const w = await getWorkOnchain(workId);

  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    abi: keryxAbi,
    functionName: 'settleCitation',
    args: [workId, reader, w.price],
  });
  await publicClient.waitForTransactionReceipt({ hash });

  return {
    hash,
    workId,
    amount: formatUnits(w.price, USDC_DECIMALS),
    receiptUrl: explorerTx(hash),
  };
}