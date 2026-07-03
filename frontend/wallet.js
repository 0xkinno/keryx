// frontend/wallet.js
// ---------------------------------------------------------------------------
// Multi-wallet connect via WalletConnect (Reown AppKit) + wagmi on Arc testnet.
// Gives writers (and readers) a "Connect" button with MetaMask, WalletConnect,
// Coinbase Wallet, Rabby, and any injected wallet.
//
// Install:
//   npm i wagmi viem @tanstack/react-query @reown/appkit @reown/appkit-adapter-wagmi
// Env (frontend):
//   VITE_WC_PROJECT_ID   from https://dashboard.reown.com
//   VITE_ARC_RPC_URL     Arc testnet RPC
//   VITE_ARC_CHAIN_ID    5042002 (confirm)
// ---------------------------------------------------------------------------

import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { defineChain } from '@reown/appkit/networks';

const projectId = import.meta.env.VITE_WC_PROJECT_ID;
const RPC = import.meta.env.VITE_ARC_RPC_URL;
const CHAIN_ID = Number(import.meta.env.VITE_ARC_CHAIN_ID || 5042002);

export const arcTestnet = defineChain({
  id: CHAIN_ID,
  caipNetworkId: `eip155:${CHAIN_ID}`,
  chainNamespace: 'eip155',
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: [RPC] } },
  testnet: true,
});

export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: [arcTestnet],
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

// Creates the modal + injects <appkit-button> web component into your app.
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
  features: { analytics: false },
});

/*
  Usage in your React root:

  import { WagmiProvider } from 'wagmi';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { wagmiConfig } from './wallet.js';
  const qc = new QueryClient();

  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </WagmiProvider>

  Anywhere in the UI, the connect button is just:
    <appkit-button />

  Read the connected account with wagmi hooks:
    const { address, isConnected } = useAccount();
*/
