import { describe, expect, it } from 'vitest'
import type { AccountLeg, EModeRiskOverride } from './health'
import {
  MAX_UINT256, borrowAmountBaseForTargetHF, computeAccountData, healthFactorAfterBorrow,
} from './health'

// Units: base currency = USD with 8 decimals (10^8 per dollar). LT/LTV in bps.
const USD = 100_000_000n

function leg(overrides: Partial<AccountLeg>): AccountLeg {
  return { reserveId: 0, balanceBase: 0n, debtBase: 0n, ltvBps: 7500n, liquidationThresholdBps: 8000n, ...overrides }
}

describe('computeAccountData (GenericLogic.calculateUserAccountData parity)', () => {
  it('fixture A: 10,000 collateral (LT 8000), 5,000 debt -> HF 1.6, avail 2,500', () => {
    const legs = [leg({ balanceBase: 10_000n * USD, debtBase: 5_000n * USD })]
    const account = computeAccountData(legs, null)
    expect(account.totalCollateralBase).toBe(10_000n * USD)
    expect(account.totalDebtBase).toBe(5_000n * USD)
    expect(account.avgLtvBps).toBe(7500n)
    expect(account.avgLiquidationThresholdBps).toBe(8000n)
    expect(account.healthFactorWad).toBe(1_600_000_000_000_000_000n)
    expect(account.availableBorrowsBase).toBe(2_500n * USD)
    expect(account.hasZeroLtvCollateral).toBe(false)
  })

  it('zero debt -> HF is max uint256', () => {
    const account = computeAccountData([leg({ balanceBase: 10_000n * USD })], null)
    expect(account.healthFactorWad).toBe(MAX_UINT256)
    expect(account.availableBorrowsBase).toBe(7_500n * USD)
  })

  it('debt with no collateral -> HF 0, no borrowing power', () => {
    const account = computeAccountData([leg({ debtBase: 5_000n * USD })], null)
    expect(account.healthFactorWad).toBe(0n)
    expect(account.availableBorrowsBase).toBe(0n)
  })

  it('empty account -> max HF, zeros elsewhere', () => {
    const account = computeAccountData([], null)
    expect(account.healthFactorWad).toBe(MAX_UINT256)
    expect(account.totalCollateralBase).toBe(0n)
    expect(account.availableBorrowsBase).toBe(0n)
  })

  it('LTV-0 collateral counts toward HF but NOT borrowing power (+ flag)', () => {
    const legs = [
      leg({ reserveId: 0, balanceBase: 10_000n * USD, debtBase: 4_000n * USD }),
      leg({ reserveId: 1, balanceBase: 5_000n * USD, ltvBps: 0n, liquidationThresholdBps: 7000n }),
    ]
    const account = computeAccountData(legs, null)
    // LT-weighted sum = 10000e8*8000 + 5000e8*7000 = 11_500_000_000_000_000
    expect(account.healthFactorWad).toBe(2_875_000_000_000_000_000n) // 11.5e15 wadDiv 4000e8 / 1e4
    expect(account.avgLtvBps).toBe(5000n) // only the LTV-7500 leg contributes
    expect(account.avgLiquidationThresholdBps).toBe(7666n) // floor(11.5e15 / 1.5e12)
    expect(account.availableBorrowsBase).toBe(3_500n * USD) // 15000e8*50% - 4000e8
    expect(account.hasZeroLtvCollateral).toBe(true)
  })
})

describe('eMode LT/LTV substitution', () => {
  const emode: EModeRiskOverride = {
    categoryId: 1,
    ltvBps: 9000n,
    liquidationThresholdBps: 9500n,
    collateralBitmap: 0b1000n, // only reserveId 3
    ltvzeroBitmap: 0n,
  }

  it('reserve bit set -> category LT and LTV used', () => {
    const legs = [leg({ reserveId: 3, balanceBase: 10_000n * USD, debtBase: 5_000n * USD })]
    const account = computeAccountData(legs, emode)
    expect(account.healthFactorWad).toBe(1_900_000_000_000_000_000n)
    expect(account.avgLtvBps).toBe(9000n)
  })

  it('reserve bit NOT set -> reserve params used', () => {
    const legs = [leg({ reserveId: 4, balanceBase: 10_000n * USD, debtBase: 5_000n * USD })]
    const account = computeAccountData(legs, emode)
    expect(account.healthFactorWad).toBe(1_600_000_000_000_000_000n)
    expect(account.avgLtvBps).toBe(7500n)
  })

  it('ltvzeroBitmap bit forces LTV 0 while category LT still applies', () => {
    const zeroLtvEmode: EModeRiskOverride = { ...emode, ltvzeroBitmap: 0b1000n }
    const legs = [leg({ reserveId: 3, balanceBase: 10_000n * USD, debtBase: 5_000n * USD })]
    const account = computeAccountData(legs, zeroLtvEmode)
    expect(account.healthFactorWad).toBe(1_900_000_000_000_000_000n) // LT 9500 still
    expect(account.avgLtvBps).toBe(0n)
    expect(account.availableBorrowsBase).toBe(0n)
    expect(account.hasZeroLtvCollateral).toBe(true)
  })
})

describe('borrowAmountBaseForTargetHF <-> healthFactorAfterBorrow round trip', () => {
  const legs = [leg({ balanceBase: 10_000n * USD })]

  it('target 2.0 on clean 10,000 collateral -> 4,000 debt, exact round trip', () => {
    const extra = borrowAmountBaseForTargetHF(legs, null, 2_000_000_000_000_000_000n)
    expect(extra).toBe(4_000n * USD)
    expect(healthFactorAfterBorrow(legs, null, extra)).toBe(2_000_000_000_000_000_000n)
  })

  it('one more dollar of debt drops HF below target', () => {
    const extra = borrowAmountBaseForTargetHF(legs, null, 2_000_000_000_000_000_000n)
    expect(healthFactorAfterBorrow(legs, null, extra + USD)).toBe(1_999_500_124_968_757_810n)
  })

  it('target 1.6 -> 5,000 debt', () => {
    expect(borrowAmountBaseForTargetHF(legs, null, 1_600_000_000_000_000_000n)).toBe(5_000n * USD)
  })

  it('already at/below target -> 0', () => {
    const withDebt = [leg({ balanceBase: 10_000n * USD, debtBase: 5_000n * USD })]
    expect(borrowAmountBaseForTargetHF(withDebt, null, 1_600_000_000_000_000_000n)).toBe(0n)
    const belowTarget = [leg({ balanceBase: 10_000n * USD, debtBase: 6_000n * USD })]
    expect(borrowAmountBaseForTargetHF(belowTarget, null, 1_600_000_000_000_000_000n)).toBe(0n)
  })

  it('eMode raises the allowance: LT 9500 target 2.0 -> 4,750 debt', () => {
    const emode: EModeRiskOverride = {
      categoryId: 1, ltvBps: 9000n, liquidationThresholdBps: 9500n, collateralBitmap: 0b1n, ltvzeroBitmap: 0n,
    }
    expect(borrowAmountBaseForTargetHF(legs, emode, 2_000_000_000_000_000_000n)).toBe(4_750n * USD)
  })

  it('rejects non-positive target', () => {
    expect(() => borrowAmountBaseForTargetHF(legs, null, 0n)).toThrow()
  })

  it('healthFactorAfterBorrow with zero total debt -> max uint256', () => {
    expect(healthFactorAfterBorrow(legs, null, 0n)).toBe(MAX_UINT256)
  })
})
