import { HL_INFO_URL } from './networks'

export interface Market {
  /** Hyperliquid name: 'BTC', or 'xyz:NVDA' for equities and commodities. */
  symbol: string
  /** FairProp asset id: the Hyperliquid perp index, or 10000 + index on the xyz dex. */
  assetId: number
  szDecimals: number
  maxLeverage: number
  markPx: number
}

const XYZ_OFFSET = 10_000

type MetaAndCtxs = [
  { universe: { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }[] },
  { markPx?: string }[],
]

async function info<T>(body: unknown): Promise<T> {
  const res = await fetch(HL_INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Hyperliquid info ${res.status}`)
  return res.json() as Promise<T>
}

// MARK, not mid: the keeper's checks and the mainnet engine (precompile 0x806) both use mark.
export async function fetchMarkets(): Promise<Market[]> {
  const markets: Market[] = []
  for (const dex of [undefined, 'xyz'] as const) {
    const [meta, ctxs] = await info<MetaAndCtxs>(dex ? { type: 'metaAndAssetCtxs', dex } : { type: 'metaAndAssetCtxs' })
    meta.universe.forEach((a, i) => {
      if (a.isDelisted) return
      markets.push({
        symbol: a.name,
        assetId: (dex ? XYZ_OFFSET : 0) + i,
        szDecimals: a.szDecimals,
        maxLeverage: a.maxLeverage,
        markPx: Number(ctxs[i]?.markPx ?? NaN),
      })
    })
  }
  return markets
}

/** Accepts 'BTC', 'xyz:NVDA', or 'NVDA' (resolved to xyz when no crypto perp has that name). */
export function findMarket(markets: Market[], asset: string | number): Market {
  const m = typeof asset === 'number'
    ? markets.find((x) => x.assetId === asset)
    : markets.find((x) => x.symbol === asset) ?? markets.find((x) => x.symbol === `xyz:${asset}`)
  if (!m) throw new Error(`unknown market: ${asset}`)
  return m
}
