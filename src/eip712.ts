import type { Address } from 'viem'
import { NETWORKS, type Network } from './networks'

// Must match the engine's LIMIT_ORDER_TYPEHASH and DOMAIN_SEPARATOR exactly.
export function orderDomain(network: Network) {
  return {
    name: 'FairProp SimulationEngine',
    version: '1',
    chainId: NETWORKS[network].chain.id,
    verifyingContract: NETWORKS[network].simulationEngine as Address,
  } as const
}

export const LIMIT_ORDER_TYPES = {
  LimitOrder: [
    { name: 'challengeId',  type: 'uint256' },
    { name: 'assetId',      type: 'uint32'  },
    { name: 'isBuy',        type: 'bool'    },
    { name: 'size',         type: 'uint128' },
    { name: 'fillPx',       type: 'uint128' },
    { name: 'leverage',     type: 'uint8'   },
    { name: 'triggerAbove', type: 'bool'    },
    { name: 'reduceOnly',   type: 'bool'    },
    { name: 'nonce',        type: 'uint256' },
    { name: 'expiry',       type: 'uint256' },
  ],
} as const

// Off-chain only: the orders API checks it before marking an order cancelled. The engine never
// sees it, so a cancelled signature stays valid on-chain (see README, "Cancelling").
export const CANCEL_ORDER_TYPES = {
  CancelOrder: [
    { name: 'challengeId', type: 'uint256' },
    { name: 'nonce',       type: 'uint256' },
  ],
} as const

export interface LimitOrderMessage {
  challengeId: bigint
  assetId: number
  isBuy: boolean
  size: bigint
  fillPx: bigint
  leverage: number
  triggerAbove: boolean
  reduceOnly: boolean
  nonce: bigint
  expiry: bigint
}

// Random 256-bit nonce. The engine uses bitmap nonces, so any number of orders can be pending.
export function randomNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return BigInt('0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''))
}
