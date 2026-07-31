import { describe, expect, it } from 'vitest'
import { fromBaseCurrency, toBaseCurrency } from './convert'

// priceInBase is the oracle price in USD with 8 decimals (Aave base currency unit).
const WETH_PRICE = 300_000_000_000n // $3,000
const USDC_PRICE = 100_000_000n // $1

describe('toBaseCurrency (amount * price / 10^decimals, floor)', () => {
  it('1.5 WETH at $3,000 -> 4,500 USD8', () => {
    expect(toBaseCurrency(1_500_000_000_000_000_000n, 18, WETH_PRICE)).toBe(450_000_000_000n)
  })
  it('floors dust to zero', () => {
    expect(toBaseCurrency(1n, 18, WETH_PRICE)).toBe(0n)
  })
  it('6-decimal token', () => {
    expect(toBaseCurrency(999_999n, 6, USDC_PRICE)).toBe(99_999_900n)
  })
})

describe('fromBaseCurrency (baseAmount * 10^decimals / price, floor)', () => {
  it('4,500 USD8 -> 1.5 WETH', () => {
    expect(fromBaseCurrency(450_000_000_000n, 18, WETH_PRICE)).toBe(1_500_000_000_000_000_000n)
  })
  it('floors dust to zero', () => {
    expect(fromBaseCurrency(1n, 6, WETH_PRICE)).toBe(0n)
  })
  it('throws on zero price', () => {
    expect(() => fromBaseCurrency(1n, 6, 0n)).toThrow()
  })
  it('round trip never gains value (floor both ways)', () => {
    const amount = 1_234_567_890_123_456_789n
    const roundTripped = fromBaseCurrency(toBaseCurrency(amount, 18, WETH_PRICE), 18, WETH_PRICE)
    expect(roundTripped <= amount).toBe(true)
  })
})
