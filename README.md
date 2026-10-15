# @fairprop/sdk

TypeScript SDK for [FairProp](https://fairprop.xyz), an on-chain prop-trading desk on Hyperliquid. Trade a FairProp challenge or funded account from a bot.

**No API key.** Your challenge wallet signs everything:

| Action | How it happens |
|---|---|
| Market order, close, payout | A transaction from your wallet, straight to the contracts on HyperEVM |
| Limit, TP and SL orders | EIP-712 signatures. The FairProp keeper submits them when the price crosses |
| Positions, equity, drawdown, fills | Read from the contracts and their events |

Nobody can trade for you without your signature, and every rule is enforced on-chain.

> Status: **0.1, testnet first.** The API may change before 1.0.

## Install

```sh
npm i @fairprop/sdk viem
```

Node 20+ (or any runtime with `fetch` and `crypto.getRandomValues`).

## Quick start

```ts
import { FairProp } from '@fairprop/sdk'

const fp = new FairProp({ network: 'testnet', privateKey: process.env.PRIVATE_KEY })

const [challengeId] = await fp.challenges.list()
console.log(await fp.challenges.state(challengeId))   // equity, drawdown, margin

// Market buy with a bracket
await fp.orders.market({ challengeId, asset: 'BTC', side: 'buy', size: 0.01, leverage: 5, tp: 90_000, sl: 76_000 })

// Resting limit; TP/SL activate once it fills
const { ids } = await fp.orders.limit({ challengeId, asset: 'ETH', side: 'buy', size: 0.5, price: 2_200, leverage: 3, sl: 2_100 })

// Equities and commodities trade on the xyz dex
await fp.orders.market({ challengeId, asset: 'NVDA', side: 'sell', size: 5, leverage: 2 })

fp.fills.watch(challengeId, (fill) => console.log(fill))
await fp.orders.cancel(challengeId, ids[0])
await fp.orders.close({ challengeId, asset: 'BTC' })
```

To get started on testnet:
1. Get a testnet challenge at [testnet.fairprop.xyz](https://testnet.fairprop.xyz). It's free, and the app's faucet gives you HYPE for gas.
2. Export that wallet's private key (or pass a viem `walletClient`).
3. Run `examples/read-only.ts`, then `examples/testnet-roundtrip.ts`.

## API

| Call | What it does |
|---|---|
| `fp.markets()` / `fp.market(asset)` / `fp.markPrice(asset)` | Hyperliquid markets with mark price. `asset` is `'BTC'`, `'xyz:NVDA'`, `'NVDA'`, or an asset id |
| `fp.challenges.list()` | Challenge ids owned by the wallet |
| `fp.challenges.get(id)` | Status and rules (account size, targets, limits, max leverage) |
| `fp.challenges.state(id)` | Equity, realized PnL, margin used, drawdown |
| `fp.positions(id)` | Open positions |
| `fp.orders.market({...})` | Market order (transaction). Optional `tp` / `sl` |
| `fp.orders.limit({...})` | Signed limit or stop entry. Optional `tp` / `sl` |
| `fp.orders.tpsl({...})` | TP and/or SL on an open position |
| `fp.orders.close({...})` | Reduce-only market close |
| `fp.orders.open(id)` | Pending signed orders |
| `fp.orders.cancel(id, nonce)` | Cancel a signed order (and an entry's waiting TP/SL) |
| `fp.fills.watch(id, cb)` | Stream fills from on-chain events |
| `fp.payout(fundedChallengeId)` | Withdraw your profit share from a funded account |

Sizes are in asset units (`0.01` BTC) and prices in USD. Helpers `toSzi` / `toPx` convert to contract units (1e18 sizes, 6-decimal prices).

## How it works

### Prices
All prices are Hyperliquid **mainnet** mark prices, on both FairProp networks. FairProp testnet simulates real markets, not Hyperliquid's testnet.

| | Market order fills at | What the SDK sends as `fillPx` |
|---|---|---|
| **Testnet** | The price you send. There is no on-chain oracle on testnet | The current mark. A price far from mark (more than 2%) gets the challenge cancelled by the anti-cheat check |
| **Mainnet** | On-chain mark (precompile `0x806`) ± a 1bp spread | A slippage bound: mark ± `slippageBps` (default 50) |

### Signed orders (limit, stop, TP, SL)
- **EIP-712 domain:** `{ name: 'FairProp SimulationEngine', version: '1', chainId, verifyingContract: SimulationEngine }`. Exported as `orderDomain(network)` and `LIMIT_ORDER_TYPES`.
- **Nonces** are random 256-bit values in a bitmap, so any number of orders can be pending.
- **Submission:** the SDK posts the signed order to the FairProp orders API. It checks the signer is the challenge wallet and stores the order.
- **Execution:** the keeper submits the order when mark crosses your price. Passive orders (limits, TPs) fill at your price. Stops fill at your price ∓ 1bp.
- **Brackets:** TP/SL legs attached to an entry wait until the entry fills.
- **If the keeper is down,** orders aren't triggered until it's back. Any holder of a signed order may also submit it to the contract directly (`executeOrder(..., sig)`).

### Cancelling
- `orders.cancel` signs an off-chain `CancelOrder(challengeId, nonce)`. The orders API then marks the order cancelled, and the keeper stops tracking it.
- The nonce is **not** burned on-chain, so the original signature stays technically valid.
- On mainnet that matters little: the contract still requires mark to cross your price.
- To make an order unusable for good, let it fill or give it an `expiry`.

### Rate limits
- None on-chain. Your RPC's limits apply; pass your own `rpcUrl` for bots.
- Hyperliquid's public info API is rate-limited per IP. `fp.markets()` caches for 2s.

### Testnet caveats
Testnet trusts the caller's prices:
- Market orders fill at the `fillPx` you send.
- A signed order can be submitted directly at any time, without its price being reached.

The keeper flags deviations of more than 2% from mark and cancels the challenge. Testnet results are for building and testing bots, not for proving an edge. Mainnet reads prices on-chain and has neither gap.

## Rules for bots
Challenge and funded-account rules (daily loss, max drawdown, leverage) are enforced by the contracts, the same for bots as for manual traders. <!-- TODO(Jan): state the automated-trading policy here before publishing (docs/Backlog.md, "Automated-trading policy"). -->

## Development

```sh
npm i
npm test           # unit tests
LIVE=1 npm test    # also checks the EIP-712 domain against the deployed contracts
npm run build
npm run sync-abis  # after a contract redeploy (from ../fairprop), plus addresses in src/networks.ts
```

MIT licensed.
