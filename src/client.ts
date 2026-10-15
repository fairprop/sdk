import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
  zeroAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { DEFAULT_SLIPPAGE_BPS, NETWORKS, firestoreDocsUrl, ordersApiUrl, type Network } from './networks'
import { CANCEL_ORDER_TYPES, LIMIT_ORDER_TYPES, orderDomain, randomNonce, type LimitOrderMessage } from './eip712'
import { fetchMarkets, findMarket, type Market } from './markets'
import { fromPx, fromSzi, fromUsdc, toPx, toSzi } from './units'

export interface FairPropOptions {
  /** Only 'testnet' for now: mainnet support comes with the next mainnet deployment. */
  network?: Network
  /** Hex private key of the challenge wallet. Or pass `account` / `walletClient`. */
  privateKey?: Hex
  account?: Account
  walletClient?: WalletClient
  /** HyperEVM RPC; defaults to the public endpoint. Use your own for bots. */
  rpcUrl?: string
  /** Override the orders API (local emulator, staging). */
  ordersApiUrl?: string
}

export type Side = 'buy' | 'sell'
type Asset = string | number

export interface TpSl {
  tp?: number
  sl?: number
}

export interface MarketOrderParams extends TpSl {
  challengeId: bigint | number
  asset: Asset
  side: Side
  /** Size in asset units, e.g. 0.01 BTC. */
  size: number | string
  leverage: number
  /** Mainnet only: max deviation from mark. Default 50 (0.5%). */
  slippageBps?: number
  /** Close or shrink only; reverts instead of flipping. */
  reduceOnly?: boolean
}

export interface LimitOrderParams extends TpSl {
  challengeId: bigint | number
  asset: Asset
  side: Side
  size: number | string
  price: number
  leverage: number
  /** Unix seconds; 0 / omitted = good till cancelled. */
  expiry?: number
}

export interface PositionTpSlParams extends TpSl {
  challengeId: bigint | number
  asset: Asset
  /** Defaults to the full position. */
  size?: number | string
}

export interface Position {
  positionId: bigint
  assetId: number
  symbol?: string
  side: 'long' | 'short'
  size: number
  entryPx: number
  leverage: number
  openedAt: Date
}

export interface OpenOrder {
  id: string
  nonce: string
  assetId: number
  isBuy: boolean
  size: number
  price: number
  leverage: number
  triggerAbove: boolean
  reduceOnly: boolean
  status: 'pending' | 'waiting'
  bracketId?: string
}

export interface Fill {
  challengeId: bigint
  positionId: bigint
  assetId: number
  /** Position size after the fill, signed (negative = short). */
  newSize: number
  price: number
  fee: number
  realizedPnl: number
  txHash: Hash
}

export class FairPropApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

const CHALLENGE_STATUS = ['active', 'passed', 'failed', 'cancelled', 'expired'] as const

export class FairProp {
  readonly network: Network
  readonly public: PublicClient
  readonly wallet: WalletClient
  readonly account: Account
  private readonly net: (typeof NETWORKS)[Network]
  private readonly apiUrl: string
  private marketsCache?: { at: number; markets: Market[] }

  constructor(opts: FairPropOptions) {
    this.network = opts.network ?? 'testnet'
    if (this.network === 'mainnet') {
      throw new Error('FairProp: this SDK version supports testnet only; mainnet comes with the next mainnet deployment')
    }
    this.net = NETWORKS[this.network]
    this.apiUrl = opts.ordersApiUrl ?? ordersApiUrl(this.network)
    const transport = http(opts.rpcUrl)

    const account = opts.account ?? opts.walletClient?.account ?? (opts.privateKey ? privateKeyToAccount(opts.privateKey) : undefined)
    if (!account) throw new Error('FairProp: pass privateKey, account or walletClient')
    this.account = account

    this.public = createPublicClient({ chain: this.net.chain, transport }) as PublicClient
    this.wallet = opts.walletClient ?? createWalletClient({ account, chain: this.net.chain, transport })
  }

  get address(): Address {
    return this.account.address
  }

  // ---------------------------------------------------------------------------------------------
  // Markets and prices (Hyperliquid mainnet mark, on both networks)
  // ---------------------------------------------------------------------------------------------

  /** All tradable markets with their mark price. Cached for `maxAgeMs` (default 2s). */
  async markets(maxAgeMs = 2_000): Promise<Market[]> {
    if (!this.marketsCache || Date.now() - this.marketsCache.at > maxAgeMs) {
      this.marketsCache = { at: Date.now(), markets: await fetchMarkets() }
    }
    return this.marketsCache.markets
  }

  async market(asset: Asset, maxAgeMs?: number): Promise<Market> {
    return findMarket(await this.markets(maxAgeMs), asset)
  }

  async markPrice(asset: Asset): Promise<number> {
    return (await this.market(asset, 0)).markPx
  }

  // ---------------------------------------------------------------------------------------------
  // Challenges, positions, payouts (contract reads and wallet transactions)
  // ---------------------------------------------------------------------------------------------

  readonly challenges = {
    /** Challenge ids owned by this wallet, oldest first. */
    list: async (): Promise<bigint[]> => {
      const ids = await this.public.readContract({
        address: this.net.challengeFactory,
        abi: this.net.abis.challengeFactory,
        functionName: 'getChallengesByWallet',
        args: [this.address],
      })
      return [...ids]
    },

    get: async (challengeId: bigint | number) => {
      const c = await this.public.readContract({
        address: this.net.challengeFactory,
        abi: this.net.abis.challengeFactory,
        functionName: 'getChallenge',
        args: [BigInt(challengeId)],
      })
      // A missing id reads as an all-zero struct, whose status 0 would say 'active'.
      if (c.wallet === zeroAddress) throw new Error(`unknown challenge ${challengeId}`)
      return {
        challengeId: c.challengeId,
        wallet: c.wallet,
        status: CHALLENGE_STATUS[c.status] ?? 'unknown',
        startedAt: new Date(Number(c.startTimestamp) * 1000),
        rules: {
          accountSize: fromUsdc(BigInt(c.rules.accountSizeUsdc)),
          profitTargetPct: c.rules.profitTargetBps / 100,
          maxDrawdownPct: c.rules.maxDrawdownBps / 100,
          dailyLossLimitPct: c.rules.dailyLossLimitBps / 100,
          profitSplitPct: c.rules.profitSplitBps / 100,
          maxLeverage: Math.floor(c.rules.maxLeverageBps / 1000),
        },
      }
    },

    /** Equity, realized PnL, margin used (USDC) and drawdown, from the engine. */
    state: async (challengeId: bigint | number) => {
      const id = BigInt(challengeId)
      const [s, drawdownBps] = await Promise.all([
        this.public.readContract({
          address: this.net.simulationEngine,
          abi: this.net.abis.simulationEngine,
          functionName: 'getChallengeState',
          args: [id],
        }),
        this.public.readContract({
          address: this.net.simulationEngine,
          abi: this.net.abis.simulationEngine,
          functionName: 'getDrawdownBps',
          args: [id],
        }),
      ])
      // The engine creates a challenge's state on its first trade; until then it reads as zeros.
      if (s.challengeId === 0n) {
        const c = await this.challenges.get(id)
        return { equity: c.rules.accountSize, realizedPnl: 0, marginUsed: 0, drawdownPct: 0, openPositionIds: [] as bigint[] }
      }
      return {
        equity: fromUsdc(s.equityUsdc),
        realizedPnl: fromUsdc(s.realizedPnlUsdc),
        marginUsed: fromUsdc(s.marginUsed),
        drawdownPct: Number(drawdownBps) / 100,
        openPositionIds: [...s.openPositionIds],
      }
    },
  }

  async positions(challengeId: bigint | number): Promise<Position[]> {
    const [raw, markets] = await Promise.all([
      this.public.readContract({
        address: this.net.simulationEngine,
        abi: this.net.abis.simulationEngine,
        functionName: 'getOpenPositions',
        args: [BigInt(challengeId)],
      }),
      this.markets(60_000).catch(() => [] as Market[]),
    ])
    return raw
      .filter((p) => p.isOpen)
      .map((p) => ({
        positionId: p.positionId,
        assetId: p.assetId,
        symbol: markets.find((m) => m.assetId === p.assetId)?.symbol,
        side: p.szi >= 0n ? 'long' : 'short',
        size: fromSzi(p.szi >= 0n ? p.szi : -p.szi),
        entryPx: fromPx(p.entryPx),
        leverage: p.leverage,
        openedAt: new Date(Number(p.openTimestamp) * 1000),
      }))
  }

  /** Withdraw profit from a funded account (by its funded challenge id). Wallet transaction. */
  async payout(fundedChallengeId: bigint | number): Promise<Hash> {
    const accountId = await this.public.readContract({
      address: this.net.vaultManager,
      abi: this.net.abis.vaultManager,
      functionName: 'accountByFundedChallengeId',
      args: [BigInt(fundedChallengeId)],
    })
    if (accountId === 0n) throw new Error(`challenge ${fundedChallengeId} is not a funded account`)
    const { request } = await this.public.simulateContract({
      account: this.account,
      address: this.net.vaultManager,
      abi: this.net.abis.vaultManager,
      functionName: 'payout',
      args: [accountId],
    })
    return this.send(request)
  }

  // ---------------------------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------------------------

  readonly orders = {
    /**
     * Market order: a transaction from this wallet, filled in the same block.
     * Testnet fills at the price sent, which the SDK takes from Hyperliquid mainnet mark.
     * Mainnet fills at the on-chain mark; the price sent is a slippage bound.
     * TP/SL, if given, are signed first and submitted once the entry has filled.
     */
    market: async (p: MarketOrderParams) => {
      const challengeId = BigInt(p.challengeId)
      const m = await this.market(p.asset, 0)
      if (!Number.isFinite(m.markPx)) throw new Error(`no mark price for ${m.symbol}`)
      const isBuy = p.side === 'buy'
      const size = toSzi(p.size)
      const slippage = (p.slippageBps ?? DEFAULT_SLIPPAGE_BPS) / 10_000
      const px = this.network === 'mainnet' ? m.markPx * (1 + (isBuy ? slippage : -slippage)) : m.markPx

      // Sign the legs before the entry: a rejected signature should place nothing.
      const legs = await this.signLegs({ challengeId, assetId: m.assetId, entryIsBuy: isBuy, entryPx: m.markPx, size, leverage: p.leverage, tp: p.tp, sl: p.sl })

      const { request } = await this.public.simulateContract({
        account: this.account,
        address: this.net.simulationEngine,
        abi: this.net.abis.simulationEngine,
        functionName: 'executeOrder',
        args: [challengeId, m.assetId, isBuy, size, toPx(px), p.leverage, false, p.reduceOnly ?? false, 0n, 0n, '0x'],
      })
      const txHash = await this.send(request)
      const receipt = await this.public.waitForTransactionReceipt({ hash: txHash })
      if (receipt.status !== 'success') throw new Error(`market order reverted: ${txHash}`)

      const tpsl = legs.length ? await this.postOrders(legs) : undefined
      return { txHash, tpslOrderIds: tpsl?.ids }
    },

    /**
     * Limit order: signed by this wallet, kept by the FairProp keeper and submitted when mark
     * crosses `price`. Optional TP/SL wait and activate once the entry fills.
     */
    limit: async (p: LimitOrderParams) => {
      const challengeId = BigInt(p.challengeId)
      const m = await this.market(p.asset, 0)
      const isBuy = p.side === 'buy'
      const size = toSzi(p.size)
      const fillPx = toPx(p.price)
      const entry = await this.signOrder({
        challengeId,
        assetId: m.assetId,
        isBuy,
        size,
        fillPx,
        leverage: p.leverage,
        // Same rule as the app: a buy above mark is a buy-stop, below is a limit.
        triggerAbove: p.price > m.markPx,
        reduceOnly: false,
        nonce: randomNonce(),
        expiry: BigInt(p.expiry ?? 0),
      })
      const legs = await this.signLegs({ challengeId, assetId: m.assetId, entryIsBuy: isBuy, entryPx: p.price, size, leverage: p.leverage, tp: p.tp, sl: p.sl })
      return this.postOrders([...legs, entry])
    },

    /** TP and/or SL on an open position. Reduce-only, opposite side, full size by default. */
    tpsl: async (p: PositionTpSlParams) => {
      const challengeId = BigInt(p.challengeId)
      const m = await this.market(p.asset, 0)
      const pos = (await this.positions(challengeId)).find((x) => x.assetId === m.assetId)
      if (!pos) throw new Error(`no open ${m.symbol} position on challenge ${challengeId}`)
      const isLong = pos.side === 'long'
      if (p.tp !== undefined && (isLong ? p.tp <= m.markPx : p.tp >= m.markPx)) throw new Error('TP is on the wrong side of mark')
      if (p.sl !== undefined && (isLong ? p.sl >= m.markPx : p.sl <= m.markPx)) throw new Error('SL is on the wrong side of mark')
      const legs = await this.signLegs({
        challengeId,
        assetId: m.assetId,
        entryIsBuy: isLong,
        entryPx: pos.entryPx,
        size: toSzi(p.size ?? pos.size.toString()),
        leverage: pos.leverage,
        tp: p.tp,
        sl: p.sl,
        skipEntryCheck: true,
      })
      if (!legs.length) throw new Error('pass tp and/or sl')
      return this.postOrders(legs)
    },

    /** Close a position at market (reduce-only). Defaults to the full size. */
    close: async (p: { challengeId: bigint | number; asset: Asset; size?: number | string; slippageBps?: number }) => {
      const m = await this.market(p.asset, 0)
      const pos = (await this.positions(p.challengeId)).find((x) => x.assetId === m.assetId)
      if (!pos) throw new Error(`no open ${m.symbol} position on challenge ${p.challengeId}`)
      return this.orders.market({
        challengeId: p.challengeId,
        asset: m.assetId,
        side: pos.side === 'long' ? 'sell' : 'buy',
        size: p.size ?? pos.size.toString(),
        leverage: pos.leverage,
        slippageBps: p.slippageBps,
        reduceOnly: true,
      })
    },

    /** Pending and waiting signed orders of a challenge (public Firestore read). */
    open: async (challengeId: bigint | number): Promise<OpenOrder[]> => {
      const url = `${firestoreDocsUrl(this.network)}/challenges/${BigInt(challengeId)}/limitOrders?pageSize=300`
      const res = await fetch(url)
      if (!res.ok) throw new FairPropApiError(`orders read failed (${res.status})`, res.status)
      const body = (await res.json()) as { documents?: FirestoreDoc[] }
      return (body.documents ?? [])
        .map(parseOrderDoc)
        .filter((o): o is OpenOrder => o !== null)
    },

    /**
     * Cancel a signed order (and, for a limit entry, its waiting TP/SL). Signs an off-chain
     * CancelOrder message; the keeper stops tracking the order.
     */
    cancel: async (challengeId: bigint | number, nonce: bigint | string) => {
      const message = { challengeId: BigInt(challengeId), nonce: BigInt(nonce) }
      const sig = await this.wallet.signTypedData({
        account: this.account,
        domain: orderDomain(this.network),
        types: CANCEL_ORDER_TYPES,
        primaryType: 'CancelOrder',
        message,
      })
      return this.api<{ cancelled: string[] }>('/cancel', {
        challengeId: message.challengeId.toString(),
        nonce: message.nonce.toString(),
        sig,
      })
    },
  }

  // ---------------------------------------------------------------------------------------------
  // Fills (on-chain OrderExecuted events)
  // ---------------------------------------------------------------------------------------------

  readonly fills = {
    /** Fills on the challenge in a block range (default: the last 1000 blocks). */
    history: async (challengeId: bigint | number, range: { fromBlock?: bigint; toBlock?: bigint } = {}): Promise<Fill[]> => {
      const toBlock = range.toBlock ?? (await this.public.getBlockNumber())
      const fromBlock = range.fromBlock ?? (toBlock > 1000n ? toBlock - 1000n : 0n)
      return this.fillsBetween(BigInt(challengeId), fromBlock, toBlock)
    },

    /**
     * Calls `onFill` for every fill on the challenge from now on. Returns an unsubscribe.
     * Polls getLogs over block ranges: the public HyperEVM RPCs reject eth_newFilter, which
     * viem's watchContractEvent relies on.
     */
    watch: (challengeId: bigint | number, onFill: (fill: Fill) => void, opts: { intervalMs?: number; onError?: (e: Error) => void } = {}) => {
      const id = BigInt(challengeId)
      let next: bigint | undefined
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const tick = async () => {
        try {
          const head = await this.public.getBlockNumber()
          if (next === undefined) next = head + 1n
          else if (head >= next) {
            // Cap each query: RPCs limit getLogs ranges.
            const to = head - next > 999n ? next + 999n : head
            for (const fill of await this.fillsBetween(id, next, to)) onFill(fill)
            next = to + 1n
          }
        } catch (e) {
          opts.onError?.(e as Error)
        }
        if (!stopped) timer = setTimeout(tick, opts.intervalMs ?? 2_000)
      }
      void tick()
      return () => {
        stopped = true
        clearTimeout(timer)
      }
    },
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  private async fillsBetween(challengeId: bigint, fromBlock: bigint, toBlock: bigint): Promise<Fill[]> {
    const logs = await this.public.getContractEvents({
      address: this.net.simulationEngine,
      abi: this.net.abis.simulationEngine,
      eventName: 'OrderExecuted',
      args: { challengeId },
      fromBlock,
      toBlock,
    })
    return logs.map((log) => {
      const a = log.args as {
        challengeId: bigint; positionId: bigint; assetId: number
        newSzi: bigint; px: bigint; fee: bigint; realizedPnl: bigint
      }
      return {
        challengeId: a.challengeId,
        positionId: a.positionId,
        assetId: a.assetId,
        newSize: a.newSzi >= 0n ? fromSzi(a.newSzi) : -fromSzi(-a.newSzi),
        price: fromPx(a.px),
        fee: fromUsdc(a.fee),
        realizedPnl: fromUsdc(a.realizedPnl),
        txHash: log.transactionHash!,
      }
    })
  }

  private async send(request: Parameters<WalletClient['writeContract']>[0]): Promise<Hash> {
    return this.wallet.writeContract({ ...request, account: this.account, chain: this.net.chain } as Parameters<WalletClient['writeContract']>[0])
  }

  private async signOrder(message: LimitOrderMessage): Promise<SignedOrder> {
    const sig = await this.wallet.signTypedData({
      account: this.account,
      domain: orderDomain(this.network),
      types: LIMIT_ORDER_TYPES,
      primaryType: 'LimitOrder',
      message,
    })
    return { message, sig }
  }

  // TP/SL legs: reduce-only, opposite side, same size and leverage as the entry. A long's TP
  // triggers above, its SL below; a short's the other way round (as the app's levelDir).
  private async signLegs(p: {
    challengeId: bigint
    assetId: number
    entryIsBuy: boolean
    entryPx: number
    size: bigint
    leverage: number
    tp?: number
    sl?: number
    skipEntryCheck?: boolean
  }): Promise<SignedOrder[]> {
    const legs: SignedOrder[] = []
    for (const [kind, px] of [['tp', p.tp], ['sl', p.sl]] as const) {
      if (px === undefined) continue
      const above = (kind === 'tp') === p.entryIsBuy
      if (!p.skipEntryCheck && (above ? px <= p.entryPx : px >= p.entryPx)) {
        throw new Error(`${kind.toUpperCase()} must be ${above ? 'above' : 'below'} the entry price`)
      }
      legs.push(await this.signOrder({
        challengeId: p.challengeId,
        assetId: p.assetId,
        isBuy: !p.entryIsBuy,
        size: p.size,
        fillPx: toPx(px),
        leverage: p.leverage,
        triggerAbove: above,
        reduceOnly: true,
        nonce: randomNonce(),
        expiry: 0n,
      }))
    }
    return legs
  }

  private postOrders(orders: SignedOrder[]) {
    return this.api<{ ids: string[]; bracketId?: string }>('', {
      orders: orders.map(({ message: m, sig }) => ({
        challengeId: m.challengeId.toString(),
        assetId: m.assetId,
        isBuy: m.isBuy,
        size: m.size.toString(),
        fillPx: m.fillPx.toString(),
        leverage: m.leverage,
        triggerAbove: m.triggerAbove,
        reduceOnly: m.reduceOnly,
        nonce: m.nonce.toString(),
        expiry: m.expiry.toString(),
        sig,
      })),
    })
  }

  private async api<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.apiUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) throw new FairPropApiError(json.error ?? `orders API ${res.status}`, res.status)
    return json as T
  }
}

interface SignedOrder {
  message: LimitOrderMessage
  sig: Hex
}

type FirestoreValue = { stringValue?: string; integerValue?: string; booleanValue?: boolean; doubleValue?: number }
interface FirestoreDoc {
  name: string
  fields: Record<string, FirestoreValue>
}

function parseOrderDoc(d: FirestoreDoc): OpenOrder | null {
  const f = d.fields
  const str = (k: string) => f[k]?.stringValue
  const num = (k: string) => Number(f[k]?.integerValue ?? f[k]?.doubleValue)
  const status = str('status')
  if (status !== 'pending' && status !== 'waiting') return null
  return {
    id: d.name.split('/').pop()!,
    nonce: str('nonce')!,
    assetId: num('assetId'),
    isBuy: f.isBuy?.booleanValue === true,
    size: fromSzi(BigInt(str('size') ?? '0')),
    price: fromPx(BigInt(str('fillPx') ?? '0')),
    leverage: num('leverage'),
    triggerAbove: f.triggerAbove?.booleanValue === true,
    reduceOnly: f.reduceOnly?.booleanValue === true,
    status,
    bracketId: str('bracketId'),
  }
}
