import { describe, expect, it } from 'vitest'
import { fromPx, fromSzi, toPx, toSzi } from '../src/units'

describe('units', () => {
  it('converts sizes without float error', () => {
    expect(toSzi(0.1)).toBe(100000000000000000n)
    expect(toSzi('0.3')).toBe(300000000000000000n)
    expect(toSzi(1e-7)).toBe(100000000000n)
    expect(toSzi(2)).toBe(2000000000000000000n)
    expect(fromSzi(toSzi('1.234567'))).toBe(1.234567)
  })

  it('rejects bad sizes and prices', () => {
    expect(() => toSzi(-1)).toThrow()
    expect(() => toSzi('abc')).toThrow()
    expect(() => toPx(0)).toThrow()
    expect(() => toPx(Number.NaN)).toThrow()
  })

  it('converts prices to 6 decimals', () => {
    expect(toPx(64123.5)).toBe(64123500000n)
    expect(fromPx(64123500000n)).toBe(64123.5)
  })
})
