import { describe, expect, it } from 'vitest'
import type { EModeCategoryInfo } from '../abis/ui-pool-data-provider'
import { effectiveRiskParams, findSharedEModeCategories, isReserveEnabledOnBitmap } from './emode'

function category(overrides: Partial<EModeCategoryInfo>): EModeCategoryInfo {
  return {
    id: 1,
    ltvBps: 9300n,
    liquidationThresholdBps: 9500n,
    liquidationBonusBps: 10100n,
    collateralBitmap: 0n,
    borrowableBitmap: 0n,
    ltvzeroBitmap: 0n,
    isolated: false,
    label: 'test',
    ...overrides,
  }
}

describe('isReserveEnabledOnBitmap ((bitmap >> id) & 1)', () => {
  it('reads individual bits', () => {
    expect(isReserveEnabledOnBitmap(0b0110n, 0)).toBe(false)
    expect(isReserveEnabledOnBitmap(0b0110n, 1)).toBe(true)
    expect(isReserveEnabledOnBitmap(0b0110n, 2)).toBe(true)
    expect(isReserveEnabledOnBitmap(0b0110n, 3)).toBe(false)
    expect(isReserveEnabledOnBitmap(1n << 127n, 127)).toBe(true)
  })
  it('throws outside [0, 128) like EModeConfiguration', () => {
    expect(() => isReserveEnabledOnBitmap(1n, -1)).toThrow()
    expect(() => isReserveEnabledOnBitmap(1n, 128)).toThrow()
    expect(() => isReserveEnabledOnBitmap(1n, 1.5)).toThrow()
  })
})

describe('findSharedEModeCategories', () => {
  const cats = [
    category({ id: 1, collateralBitmap: 0b0110n, borrowableBitmap: 0b1010n, label: 'ETH correlated' }),
    category({ id: 2, collateralBitmap: 0b0110n, borrowableBitmap: 0b1010n, isolated: true, label: 'isolated' }),
    category({ id: 3, collateralBitmap: 0b0001n, borrowableBitmap: 0b1010n, label: 'other' }),
  ]
  it('returns categories where collateral bit AND borrowable bit are both set', () => {
    expect(findSharedEModeCategories(2, 3, cats).map((c) => c.id)).toEqual([1])
    expect(findSharedEModeCategories(0, 1, cats).map((c) => c.id)).toEqual([3])
  })
  it('excludes isolated categories (P0 policy)', () => {
    expect(findSharedEModeCategories(1, 1, cats).map((c) => c.id)).toEqual([1]) // 2 would match but is isolated
  })
  it('empty when nothing matches', () => {
    expect(findSharedEModeCategories(3, 0, cats)).toEqual([])
  })
})

describe('effectiveRiskParams (ValidationLogic.getUserReserveLtv rules)', () => {
  const base = { ltvBps: 7500n, liquidationThresholdBps: 8000n }
  it('no category -> base params', () => {
    expect(effectiveRiskParams(3, base, null)).toEqual(base)
  })
  it('bit not in collateralBitmap -> base params', () => {
    expect(effectiveRiskParams(4, base, category({ collateralBitmap: 0b1000n }))).toEqual(base)
  })
  it('bit set -> category params', () => {
    expect(effectiveRiskParams(3, base, category({ collateralBitmap: 0b1000n }))).toEqual({
      ltvBps: 9300n,
      liquidationThresholdBps: 9500n,
    })
  })
  it('bit set in ltvzeroBitmap too -> LTV forced to 0, category LT kept', () => {
    expect(
      effectiveRiskParams(3, base, category({ collateralBitmap: 0b1000n, ltvzeroBitmap: 0b1000n })),
    ).toEqual({ ltvBps: 0n, liquidationThresholdBps: 9500n })
  })
})
