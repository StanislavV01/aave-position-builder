import { describe, expect, it } from 'vitest'
import { rayRateToApy } from './apy'

describe('rayRateToApy (per-second compounding of a ray APR — display only)', () => {
  it('zero rate -> zero APY', () => {
    expect(rayRateToApy(0n)).toBe(0)
  })
  it('5% APR -> ~5.127% APY (known value)', () => {
    expect(rayRateToApy(5n * 10n ** 25n)).toBeCloseTo(0.05127109362458726, 9)
  })
  it('10% APR -> ~10.517% APY (known value)', () => {
    expect(rayRateToApy(10n ** 26n)).toBeCloseTo(0.10517091994187133, 9)
  })
  it('APY always exceeds APR for positive rates', () => {
    expect(rayRateToApy(5n * 10n ** 25n)).toBeGreaterThan(0.05)
  })
})
