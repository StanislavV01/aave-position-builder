import { describe, expect, it } from 'vitest'
import { RAY } from './ray'
import {
  calculateCompoundedInterest, calculateLinearInterest, getATokenBalance, getVTokenBalance,
} from './accrual'

const T0 = 1_754_000_000n // arbitrary epoch seconds
const YEAR = 31_536_000n

describe('calculateLinearInterest (MathUtils parity)', () => {
  it('exp == 0 -> RAY', () => {
    expect(calculateLinearInterest(RAY / 10n, T0, T0)).toBe(RAY)
  })
  it('5% APR over exactly one year -> 1.05 ray exactly', () => {
    expect(calculateLinearInterest(RAY / 20n, T0, T0 + YEAR)).toBe(1_050_000_000_000_000_000_000_000_000n)
  })
  it('100% APR over 1 second -> RAY + RAY/31536000 (floored)', () => {
    expect(calculateLinearInterest(RAY, T0, T0 + 1n)).toBe(1_000_000_031_709_791_983_764_586_504n)
  })
})

describe('calculateCompoundedInterest (3-term binomial, MathUtils parity)', () => {
  it('exp == 0 -> RAY', () => {
    expect(calculateCompoundedInterest(RAY / 10n, T0, T0)).toBe(RAY)
  })
  it('10% APR over exactly one year matches the hand-derived binomial value', () => {
    // x = 0.1 ray exactly; RAY + x + rayMul(x, x/2 + rayMul(x, x/6))
    // = 1e27 + 1e26 + 5166666666666666666666667  (derivation in the plan)
    expect(calculateCompoundedInterest(RAY / 10n, T0, T0 + YEAR)).toBe(1_105_166_666_666_666_666_666_666_667n)
  })
  it('5% APR over 30 days (regression vector)', () => {
    expect(calculateCompoundedInterest(RAY / 20n, T0, T0 + 2_592_000n)).toBe(1_004_118_044_969_757_105_730_597_891n)
  })
  it('compounded >= linear for the same rate/period', () => {
    const rate = RAY / 20n
    const compounded = calculateCompoundedInterest(rate, T0, T0 + YEAR)
    const linear = calculateLinearInterest(rate, T0, T0 + YEAR)
    expect(compounded > linear).toBe(true)
  })
})

describe('getATokenBalance / getVTokenBalance (rayMul of scaled balance and index)', () => {
  it('scaled 2e18 at index 1.05 ray -> 2.1e18', () => {
    const index = 1_050_000_000_000_000_000_000_000_000n
    expect(getATokenBalance(2n * 10n ** 18n, index)).toBe(2_100_000_000_000_000_000n)
    expect(getVTokenBalance(2n * 10n ** 18n, index)).toBe(2_100_000_000_000_000_000n)
  })
  it('index RAY is identity', () => {
    expect(getATokenBalance(123_456n, RAY)).toBe(123_456n)
  })
  it('zero scaled balance stays zero', () => {
    expect(getVTokenBalance(0n, RAY + 1n)).toBe(0n)
  })
})
