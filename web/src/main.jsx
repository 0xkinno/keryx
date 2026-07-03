import React from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from './wallet.js';
import App from './App.jsx';
import './keryx.css';

const qc = new QueryClient();

createRoot(document.getElementById('root')).render(
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </WagmiProvider>
);