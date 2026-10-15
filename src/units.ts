// Contract units: sizes are 1e18 fixed point, prices and USDC amounts 6-decimal.

const SZI_SCALE = 10n ** 18n
const PX_SCALE = 1_000_000

// Parses via the decimal string so 0.1 stays exactly 1e17, not 100000000000000005551.
export function toSzi(size: number | string): bigint {
  const text = typeof size === 'number' ? numberToPlain(size) : size.trim()
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`invalid size: ${size}`)
  const [whole, frac = ''] = text.split('.')
  return BigInt(whole) * SZI_SCALE + BigInt(frac.slice(0, 18).padEnd(18, '0'))
}

export function fromSzi(szi: bigint): number {
  return Number(szi / 1_000_000_000_000n) / 1_000_000
}

export function toPx(price: number): bigint {
  if (!Number.isFinite(price) || price <= 0) throw new Error(`invalid price: ${price}`)
  return BigInt(Math.round(price * PX_SCALE))
}

export function fromPx(px: bigint): number {
  return Number(px) / PX_SCALE
}

export const fromUsdc = fromPx

// 1e-7.toString() is '1e-7'; sizes never need more than 18 decimals.
function numberToPlain(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid size: ${n}`)
  const s = n.toString()
  return s.includes('e') ? n.toFixed(18).replace(/0+$/, '').replace(/\.$/, '') : s
}
