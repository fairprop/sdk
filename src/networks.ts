import { defineChain, type Address } from 'viem'
import { ChallengeFactoryTestnetAbi } from './abis/ChallengeFactoryTestnet'
import { ChallengeFactoryMainnetAbi } from './abis/ChallengeFactoryMainnet'
import { SimulationEngineTestnetAbi } from './abis/SimulationEngineTestnet'
import { SimulationEngineMainnetAbi } from './abis/SimulationEngineMainnet'
import { VaultManagerTestnetAbi } from './abis/VaultManagerTestnet'
import { VaultManagerMainnetAbi } from './abis/VaultManagerMainnet'

export type Network = 'testnet' | 'mainnet'

export const hyperEvmTestnet = defineChain({
  id: 998,
  name: 'HyperEVM Testnet',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpcs.chain.link/hyperevm/testnet'] } },
  blockExplorers: { default: { name: 'HyperEVM Testnet Explorer', url: 'https://testnet.hyperevm-explorer.xyz' } },
  testnet: true,
})

export const hyperEvmMainnet = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
  blockExplorers: { default: { name: 'HyperEVMScan', url: 'https://hyperevmscan.io' } },
})

// Contract addresses as deployed. Keep in sync with the FairProp app on every redeploy
// (scripts/sync-abis.sh copies the matching ABIs).
export const NETWORKS = {
  testnet: {
    chain: hyperEvmTestnet,
    firebaseProject: 'fairprop-ee3a1',
    challengeFactory: '0xB58a9b1cDF43e564EEcE9A736249B5Bad590d5e7' as Address,
    simulationEngine: '0xa6419d42d8C913fc3cFfd9de2448B3C20c8609bA' as Address,
    vaultManager: '0xf2Cb111dd0a112b1012a887F480835faB72b8eD9' as Address,
    abis: {
      challengeFactory: ChallengeFactoryTestnetAbi,
      simulationEngine: SimulationEngineTestnetAbi,
      vaultManager: VaultManagerTestnetAbi,
    },
  },
  mainnet: {
    chain: hyperEvmMainnet,
    firebaseProject: 'fairprop-prod',
    challengeFactory: '0xeb6e01eb0Cd2e99CD0FaF7Ea67957b5f66AA6c0f' as Address,
    simulationEngine: '0x8DfFc96F0831bFD2346C1f185b8F3e3A490E8628' as Address,
    vaultManager: '0x58C52d04C223377053Ad4D6d74Cbf9b74123c20d' as Address,
    abis: {
      challengeFactory: ChallengeFactoryMainnetAbi,
      simulationEngine: SimulationEngineMainnetAbi,
      vaultManager: VaultManagerMainnetAbi,
    },
  },
} as const

export function ordersApiUrl(network: Network): string {
  return `https://us-central1-${NETWORKS[network].firebaseProject}.cloudfunctions.net/orders`
}

export function firestoreDocsUrl(network: Network): string {
  return `https://firestore.googleapis.com/v1/projects/${NETWORKS[network].firebaseProject}/databases/(default)/documents`
}

// Prices always come from Hyperliquid MAINNET, on both FairProp networks: the testnet engine is
// a simulation of real markets, not of Hyperliquid's testnet.
export const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
export const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws'

// Mainnet market orders: fillPx is a slippage bound around mark, as in the app.
export const DEFAULT_SLIPPAGE_BPS = 50
