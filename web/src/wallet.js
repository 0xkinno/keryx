import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { defineChain } from '@reown/appkit/networks';

export const ARC_CHAIN_ID = 5042002;
export const USDC_ADDR    = '0x3600000000000000000000000000000000000000';
export const KERYX_ADDR   = '0x110b63dd1698ce10392c551981ab426fd890420a'; // ← REPLACE with new deployed address
export const EXPLORER     = 'https://testnet.arcscan.app';
export const API_URL      = 'https://keryx.onrender.com';

export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  caipNetworkId: `eip155:${ARC_CHAIN_ID}`,
  chainNamespace: 'eip155',
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
  blockExplorerUrls: { default: { name: 'Arcscan', url: EXPLORER } },
  testnet: true,
});

const projectId = import.meta.env.VITE_WC_PROJECT_ID;

export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: [arcTestnet],
});
export const wagmiConfig = wagmiAdapter.wagmiConfig;

createAppKit({
  adapters: [wagmiAdapter],
  networks: [arcTestnet],
  projectId,
  metadata: {
    name: 'KERYX',
    description: 'An answer engine that pays its sources.',
    url: 'https://keryx.app',
    icons: ['https://keryx.app/icon.png'],
  },
  features: { analytics: false, email: false, socials: [] },
});

/**
 * KERYX_ABI — matches KeryxSplits v3: fully self-contained on-chain catalog.
 * registerWork now stores title + url on-chain too, and the contract keeps
 * its own enumerable list of every workId ever registered (workCount +
 * getWorkIdsPage), so the full catalog can be read directly from the chain
 * with no off-chain index required.
 */
export const KERYX_ABI = [
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
];

export const ERC20_ABI = [
  { name: 'approve',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view',       inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'transfer',  type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
];