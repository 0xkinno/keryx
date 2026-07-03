// src/chain/usdc.js
// USDC (6-decimal) helpers on Arc. USDC_ADDRESS must be the USDC token on Arc
// testnet — CONFIRM from developers.circle.com.

import 'dotenv/config';
import { getContract, parseUnits, formatUnits } from 'viem';
import { publicClient } from './arc.js';

export const USDC_ADDRESS = process.env.USDC_ADDRESS;
export const USDC_DECIMALS = 6;

export const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 't', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
];

/** "$0.0006" or 0.0006 -> 600n base units. */
export function usdc(amount) {
  const n = typeof amount === 'string' ? amount.replace(/[$,\s]/g, '') : String(amount);
  return parseUnits(n, USDC_DECIMALS);
}

/** base units -> human string, e.g. 600n -> "0.000600". */
export function fmtUsdc(units) {
  return Number(formatUnits(units, USDC_DECIMALS)).toFixed(6);
}

export async function balanceOf(address) {
  return publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [address] });
}

export async function allowance(owner, spender) {
  return publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] });
}

/** Approve `spender` to pull `amountUnits` from the wallet. Returns tx hash. */
export async function approve(walletClient, spender, amountUnits) {
  return walletClient.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [spender, amountUnits] });
}

/** Direct USDC transfer. Returns tx hash. */
export async function transfer(walletClient, to, amountUnits) {
  return walletClient.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'transfer', args: [to, amountUnits] });
}
