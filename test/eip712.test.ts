import { describe, expect, it } from 'vitest'
import { createPublicClient, hashDomain, hashStruct, http, keccak256, recoverTypedDataAddress, toHex } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { LIMIT_ORDER_TYPES, orderDomain, randomNonce } from '../src/eip712'
import { NETWORKS } from '../src/networks'

const EIP712_DOMAIN_FIELDS = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
] as const

// Copied from contracts/src/SimulationEngineBase.sol LIMIT_ORDER_TYPEHASH.
const CONTRACT_TYPE =
  'LimitOrder(uint256 challengeId,uint32 assetId,bool isBuy,uint128 size,uint128 fillPx,uint8 leverage,bool triggerAbove,bool reduceOnly,uint256 nonce,uint256 expiry)'

describe('eip712', () => {
  it('a signed order recovers to the signer', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const message = {
      challengeId: 7n, assetId: 0, isBuy: true, size: 10n ** 16n, fillPx: 60_000_000_000n,
      leverage: 5, triggerAbove: false, reduceOnly: false, nonce: randomNonce(), expiry: 0n,
    }
    const domain = orderDomain('testnet')
    const signature = await account.signTypedData({ domain, types: LIMIT_ORDER_TYPES, primaryType: 'LimitOrder', message })
    const signer = await recoverTypedDataAddress({ domain, types: LIMIT_ORDER_TYPES, primaryType: 'LimitOrder', message, signature })
    expect(signer).toBe(account.address)
    expect(hashStruct({ data: message, primaryType: 'LimitOrder', types: LIMIT_ORDER_TYPES })).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('nonces are random 256-bit', () => {
    const a = randomNonce()
    expect(a).not.toBe(randomNonce())
    expect(a < 2n ** 256n).toBe(true)
  })

  // Live: the deployed engines must agree with the SDK, or every signed order reverts.
  for (const network of ['testnet', 'mainnet'] as const) {
    it.skipIf(!process.env.LIVE)(`matches the deployed ${network} engine`, async () => {
      const net = NETWORKS[network]
      const client = createPublicClient({ chain: net.chain, transport: http() })
      const read = (functionName: 'DOMAIN_SEPARATOR' | 'LIMIT_ORDER_TYPEHASH') =>
        client.readContract({ address: net.simulationEngine, abi: net.abis.simulationEngine, functionName })
      expect(await read('DOMAIN_SEPARATOR')).toBe(hashDomain({ domain: { ...orderDomain(network), chainId: BigInt(net.chain.id) }, types: { EIP712Domain: EIP712_DOMAIN_FIELDS } }))
      expect(await read('LIMIT_ORDER_TYPEHASH')).toBe(keccak256(toHex(CONTRACT_TYPE)))
    })
  }
})
