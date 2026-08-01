// bigint mirror of GenericLogic.calculateUserAccountData (aave-v3-origin v3.6.0).
// HF = SUM(collateral_base_i * LT_eff_bps_i).wadDiv(totalDebtBase) / 10000
//    = type(uint256).max when totalDebtBase == 0.
// Deliberate one-rounding-step divergence from on-chain: GenericLogic floors
// avgLT = ltWeightedSum / totalCollateralBase to whole bps FIRST, then derives HF from
// that already-floored average. Here the LT-weighted SUM feeds wadDiv directly, floored
// only once at the end — so near the liquidation boundary this client HF can read up to
// ~1bp/avgLT ABOVE the on-chain value, never below. That's acceptable because this number
// is advisory, not authoritative: the hard floor for any borrow is HF > 1.0 (WAD) with a
// separate warn zone below 1.1, both comfortably outside a 1bp/avgLT slack, and every real
// transaction is gated by an on-chain preflight simulation (simulateContract) that reverts
// on the ACTUAL on-chain HF regardless of what this client-side estimate says. All values
// are base-currency USD8 / bps / wad bigints.
import { PERCENTAGE_FACTOR, WAD, percentMulFloor, wadDiv } from './ray'
import { isReserveEnabledOnBitmap } from './emode'

export const MAX_UINT256 = (1n << 256n) - 1n

export interface AccountLeg {
  reserveId: number
  balanceBase: bigint // collateral value in base currency (USD 8 dec) — 0n if not collateral
  debtBase: bigint // 0n if no debt
  ltvBps: bigint // reserve base LTV
  liquidationThresholdBps: bigint
}

export interface EModeRiskOverride {
  categoryId: number
  ltvBps: bigint
  liquidationThresholdBps: bigint
  collateralBitmap: bigint
  ltvzeroBitmap: bigint
}

export interface AccountData {
  totalCollateralBase: bigint
  totalDebtBase: bigint
  avgLtvBps: bigint
  avgLiquidationThresholdBps: bigint
  healthFactorWad: bigint
  availableBorrowsBase: bigint
  hasZeroLtvCollateral: boolean
}

function effectiveLtBps(leg: AccountLeg, emode: EModeRiskOverride | null): bigint {
  if (emode !== null && isReserveEnabledOnBitmap(emode.collateralBitmap, leg.reserveId)) {
    return emode.liquidationThresholdBps
  }
  return leg.liquidationThresholdBps
}

// ValidationLogic.getUserReserveLtv: in-category bit -> ltvzero bit forces 0,
// else category LTV; out of category -> reserve LTV.
function effectiveLtvBps(leg: AccountLeg, emode: EModeRiskOverride | null): bigint {
  if (emode !== null && isReserveEnabledOnBitmap(emode.collateralBitmap, leg.reserveId)) {
    if (isReserveEnabledOnBitmap(emode.ltvzeroBitmap, leg.reserveId)) return 0n
    return emode.ltvBps
  }
  return leg.ltvBps
}

interface WeightedSums {
  totalCollateralBase: bigint
  totalDebtBase: bigint
  ltWeightedSum: bigint
  ltvWeightedSum: bigint
  hasZeroLtvCollateral: boolean
}

function sumLegs(legs: AccountLeg[], emode: EModeRiskOverride | null): WeightedSums {
  return legs.reduce<WeightedSums>(
    (acc, current) => {
      const isCollateral = current.balanceBase > 0n
      const ltv = isCollateral ? effectiveLtvBps(current, emode) : 0n
      return {
        totalCollateralBase: acc.totalCollateralBase + (isCollateral ? current.balanceBase : 0n),
        totalDebtBase: acc.totalDebtBase + current.debtBase,
        ltWeightedSum:
          acc.ltWeightedSum + (isCollateral ? current.balanceBase * effectiveLtBps(current, emode) : 0n),
        ltvWeightedSum: acc.ltvWeightedSum + (isCollateral ? current.balanceBase * ltv : 0n),
        hasZeroLtvCollateral: acc.hasZeroLtvCollateral || (isCollateral && ltv === 0n),
      }
    },
    { totalCollateralBase: 0n, totalDebtBase: 0n, ltWeightedSum: 0n, ltvWeightedSum: 0n, hasZeroLtvCollateral: false },
  )
}

export function computeAccountData(legs: AccountLeg[], emode: EModeRiskOverride | null): AccountData {
  const sums = sumLegs(legs, emode)
  const avgLtvBps = sums.totalCollateralBase !== 0n ? sums.ltvWeightedSum / sums.totalCollateralBase : 0n
  const avgLiquidationThresholdBps =
    sums.totalCollateralBase !== 0n ? sums.ltWeightedSum / sums.totalCollateralBase : 0n
  const healthFactorWad =
    sums.totalDebtBase === 0n ? MAX_UINT256 : wadDiv(sums.ltWeightedSum, sums.totalDebtBase) / PERCENTAGE_FACTOR
  const borrowingPower = percentMulFloor(sums.totalCollateralBase, avgLtvBps)
  const availableBorrowsBase = borrowingPower > sums.totalDebtBase ? borrowingPower - sums.totalDebtBase : 0n
  return {
    totalCollateralBase: sums.totalCollateralBase,
    totalDebtBase: sums.totalDebtBase,
    avgLtvBps,
    avgLiquidationThresholdBps,
    healthFactorWad,
    availableBorrowsBase,
    hasZeroLtvCollateral: sums.hasZeroLtvCollateral,
  }
}

export function healthFactorAfterBorrow(
  legs: AccountLeg[],
  emode: EModeRiskOverride | null,
  extraDebtBase: bigint,
): bigint {
  const sums = sumLegs(legs, emode)
  const totalDebt = sums.totalDebtBase + extraDebtBase
  if (totalDebt === 0n) return MAX_UINT256
  return wadDiv(sums.ltWeightedSum, totalDebt) / PERCENTAGE_FACTOR
}

// Solves HF(existing legs + extra debt) == target for the extra debt.
// From HF = ltWeightedSum * WAD / (debt * 10000):
//   allowedTotalDebt = ltWeightedSum * WAD / (targetHfWad * 10000)   (floor)
// Floor division guarantees healthFactorAfterBorrow(result) >= target — we
// never suggest a borrow that lands below the HF the user asked for.
export function borrowAmountBaseForTargetHF(
  legs: AccountLeg[],
  emode: EModeRiskOverride | null,
  targetHfWad: bigint,
): bigint {
  if (targetHfWad <= 0n) throw new Error('borrowAmountBaseForTargetHF: target HF must be > 0')
  const sums = sumLegs(legs, emode)
  const allowedTotalDebtBase = (sums.ltWeightedSum * WAD) / (targetHfWad * PERCENTAGE_FACTOR)
  return allowedTotalDebtBase > sums.totalDebtBase ? allowedTotalDebtBase - sums.totalDebtBase : 0n
}
