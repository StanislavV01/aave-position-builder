import { describe, expect, it } from 'vitest'
import {
  HALF_PERCENTAGE_FACTOR, HALF_RAY, HALF_WAD, PERCENTAGE_FACTOR, RAY, SECONDS_PER_YEAR, WAD,
  percentDiv, percentDivCeil, percentMul, percentMulFloor, rayDiv, rayMul, wadDiv,
} from './ray'

describe('constants', () => {
  it('match WadRayMath/PercentageMath', () => {
    expect(RAY).toBe(10n ** 27n)
    expect(HALF_RAY).toBe(5n * 10n ** 26n)
    expect(WAD).toBe(10n ** 18n)
    expect(HALF_WAD).toBe(5n * 10n ** 17n)
    expect(PERCENTAGE_FACTOR).toBe(10_000n)
    expect(HALF_PERCENTAGE_FACTOR).toBe(5_000n)
    expect(SECONDS_PER_YEAR).toBe(31_536_000n)
  })
})

describe('rayMul (half-up, exact WadRayMath parity)', () => {
  it('rounds .5 up: rayMul(3, RAY/2) — true value 1.5 — rounds to 2', () => {
    expect(rayMul(3n, RAY / 2n)).toBe(2n)
  })
  it('rounds .5 up: rayMul(2, RAY/4) — true value 0.5 — rounds to 1', () => {
    expect(rayMul(2n, RAY / 4n)).toBe(1n)
  })
  it('rounds .25 down: rayMul(1, RAY/4) — true value 0.25 — rounds to 0', () => {
    expect(rayMul(1n, RAY / 4n)).toBe(0n)
  })
  it('identity and zero', () => {
    expect(rayMul(RAY, RAY)).toBe(RAY)
    expect(rayMul(123n, 0n)).toBe(0n) // Solidity returns 0 here too (no revert for b=0 in mul)
  })
})

describe('rayDiv (half-up)', () => {
  it('rayDiv(1, 3) = (1*RAY + 1)/3 floored', () => {
    expect(rayDiv(1n, 3n)).toBe(333333333333333333333333333n)
  })
  it('exact division stays exact', () => {
    expect(rayDiv(10n, 4n)).toBe(2_500_000_000_000_000_000_000_000_000n)
  })
  it('throws on division by zero (Solidity reverts)', () => {
    expect(() => rayDiv(1n, 0n)).toThrow()
  })
})

describe('wadDiv (half-up)', () => {
  it('wadDiv(1, 2) = 0.5 wad', () => {
    expect(wadDiv(1n, 2n)).toBe(500_000_000_000_000_000n)
  })
  it('wadDiv(1, 3) truncates after half-up adjustment', () => {
    expect(wadDiv(1n, 3n)).toBe(333_333_333_333_333_333n)
  })
  it('throws on zero divisor', () => {
    expect(() => wadDiv(1n, 0n)).toThrow()
  })
})

describe('percentMul / percentMulFloor', () => {
  it('percentMul rounds half up: 50% of 10001 = 5000.5 -> 5001', () => {
    expect(percentMul(10_001n, 5_000n)).toBe(5_001n)
  })
  it('percentMulFloor floors the same input: -> 5000', () => {
    expect(percentMulFloor(10_001n, 5_000n)).toBe(5_000n)
  })
  it('bps=0 yields 0 (Solidity parity)', () => {
    expect(percentMul(123n, 0n)).toBe(0n)
    expect(percentMulFloor(123n, 0n)).toBe(0n)
  })
})

describe('percentDiv / percentDivCeil', () => {
  it('percentDiv(1, 3bps) = (10000 + 1)/3 floored = 3333', () => {
    expect(percentDiv(1n, 3n)).toBe(3_333n)
  })
  it('percentDivCeil(1, 3bps) = ceil(10000/3) = 3334', () => {
    expect(percentDivCeil(1n, 3n)).toBe(3_334n)
  })
  it('percentDivCeil leaves exact results untouched', () => {
    expect(percentDivCeil(9n, 3n)).toBe(30_000n)
  })
  it('both throw on zero bps (Solidity reverts)', () => {
    expect(() => percentDiv(1n, 0n)).toThrow()
    expect(() => percentDivCeil(1n, 0n)).toThrow()
  })
})
