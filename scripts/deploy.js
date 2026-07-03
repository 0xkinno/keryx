// scripts/deploy.js
// ---------------------------------------------------------------------------
// Compiles and deploys KeryxSplits.sol directly from the terminal, using
// your existing Node.js + viem stack. No Remix, no Hardhat, no Foundry —
// just the same tools already used throughout this backend.
//
// Prerequisites:
//   npm install viem solc
//   AGENT_PRIVATE_KEY set in .env (the wallet that will own + deploy the contract)
//
// Usage:
//   node scripts/deploy.js
//
// On success, prints the deployed contract address. Copy it into:
//   - web/src/wallet.js  → KERYX_ADDR
//   - .env                → KERYX_CONTRACT_ADDRESS
// ---------------------------------------------------------------------------

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042002);
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x3600000000000000000000000000000000000000';
const AGENT_ADDRESS = process.env.AGENT_ADDRESS; // if unset, deployer itself is used as agent

const CONTRACT_PATH = path.resolve('contracts/KeryxSplits.sol');

function compile() {
  if (!fs.existsSync(CONTRACT_PATH)) {
    throw new Error(`Contract not found at ${CONTRACT_PATH}. Save KeryxSplits.sol there first.`);
  }
  const source = fs.readFileSync(CONTRACT_PATH, 'utf8');

  const input = {
    language: 'Solidity',
    sources: { 'KeryxSplits.sol': { content: source } },
    settings: {
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
      optimizer: { enabled: true, runs: 200 },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    const fatal = output.errors.filter((e) => e.severity === 'error');
    for (const e of output.errors) console.log(e.severity === 'error' ? 'ERROR:' : 'WARNING:', e.formattedMessage);
    if (fatal.length > 0) throw new Error('Solidity compilation failed — see errors above.');
  }

  const contract = output.contracts['KeryxSplits.sol']['KeryxSplits'];
  return { abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object };
}

async function main() {
  if (!PRIVATE_KEY) throw new Error('AGENT_PRIVATE_KEY not set in .env');

  console.log('Compiling KeryxSplits.sol...');
  const { abi, bytecode } = compile();
  console.log(`Compiled. Bytecode size: ${(bytecode.length - 2) / 2} bytes`);

  const account = privateKeyToAccount(PRIVATE_KEY);
  const agentAddress = AGENT_ADDRESS || account.address;

  const chain = {
    id: CHAIN_ID,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  };

  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });

  console.log(`Deploying from ${account.address}...`);
  console.log(`  _usdc:  ${USDC_ADDRESS}`);
  console.log(`  _agent: ${agentAddress}`);

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [USDC_ADDRESS, agentAddress],
  });

  console.log(`Transaction sent: ${hash}`);
  console.log('Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error('Deployment transaction reverted.');
  }

  console.log('');
  console.log('=== DEPLOYED SUCCESSFULLY ===');
  console.log(`Contract address: ${receipt.contractAddress}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. web/src/wallet.js  → set KERYX_ADDR = '${receipt.contractAddress}'`);
  console.log(`  2. .env               → set KERYX_CONTRACT_ADDRESS=${receipt.contractAddress}`);
  console.log('  3. Re-register your works on the new contract.');
}

main().catch((e) => {
  console.error('Deployment failed:', e.message);
  process.exit(1);
});