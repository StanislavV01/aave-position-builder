import type { EModeCategoryInfo } from '../abis/ui-pool-data-provider'

// ReserveConfiguration.MAX_RESERVES_COUNT — bitmap bits beyond this are invalid.
const MAX_RESERVES_COUNT = 128

// EModeConfiguration.isReserveEnabledOnBitmap: (bitmap >> reserveIndex) & 1 != 0,
// with the same out-of-range guard the contract has.
export function isReserveEnabledOnBitmap(bitmap: bigint, reserveId: number): boolean {
  if (!Number.isInteger(reserveId) || reserveId < 0 || reserveId >= MAX_RESERVES_COUNT) {
    throw new Error(`isReserveEnabledOnBitmap: reserveId out of range: ${reserveId}`)
  }
  return ((bitmap >> BigInt(reserveId)) & 1n) === 1n
}

// Categories usable for a (collateral, borrow) pair: the collateral reserve's bit
// must be set in collateralBitmap AND the borrow reserve's bit in borrowableBitmap.
// Isolated categories (v3.7) are excluded in P0 — they impose LTV-0 rules on all
// other collateral, which we don't model in the open flow.
export function findSharedEModeCategories(
  collateralReserveId: number,
  borrowReserveId: number,
  categories: EModeCategoryInfo[],
): EModeCategoryInfo[] {
  return categories.filter(
    (c) =>
      c.id !== 0 &&
      !c.isolated &&
      isReserveEnabledOnBitmap(c.collateralBitmap, collateralReserveId) &&
      isReserveEnabledOnBitmap(c.borrowableBitmap, borrowReserveId),
  )
}

// ValidationLogic.getUserReserveLtv + GenericLogic LT selection, as one helper:
// bit set in collateralBitmap -> category LT, and category LTV unless the
// ltvzeroBitmap bit forces LTV to 0. Otherwise the reserve's own params.
export function effectiveRiskParams(
  reserveId: number,
  base: { ltvBps: bigint; liquidationThresholdBps: bigint },
  category: EModeCategoryInfo | null,
): { ltvBps: bigint; liquidationThresholdBps: bigint } {
  if (category === null || !isReserveEnabledOnBitmap(category.collateralBitmap, reserveId)) {
    return { ltvBps: base.ltvBps, liquidationThresholdBps: base.liquidationThresholdBps }
  }
  const ltvBps = isReserveEnabledOnBitmap(category.ltvzeroBitmap, reserveId) ? 0n : category.ltvBps
  return { ltvBps, liquidationThresholdBps: category.liquidationThresholdBps }
}
