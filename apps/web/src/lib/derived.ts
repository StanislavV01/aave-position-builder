import type { Address } from 'viem'
import {
  computeAccountData,
  getATokenBalance,
  getVTokenBalance,
  rayRateToApy,
  toBaseCurrency,
  type AccountLeg,
  type AggregatedReserveData,
  type BaseCurrencyInfo,
  type EModeCategoryInfo,
  type EModeRiskOverride,
  type UserReserveData,
} from '@app/shared'

export interface MarketAssetView {
  asset: Address
  symbol: string
  name: string
  decimals: number
  reserveId: number
  priceBase: bigint
  supplyApy: number
  borrowApy: number
  canSupply: boolean
  canBorrow: boolean
  supplyDisabledReason: string | null
  borrowDisabledReason: string | null
  ltvBps: bigint
  liquidationThresholdBps: bigint
  availableLiquidity: bigint
  raw: AggregatedReserveData
}

export function buildMarketView(
  reserves: AggregatedReserveData[],
  baseCcy: BaseCurrencyInfo,
  ids: Record<string, number>,
): MarketAssetView[] {
  void baseCcy // values stay in base currency (USD, 8 dec) throughout; param kept per contract
  return reserves.map((r) => {
    const reserveId = ids[r.underlyingAsset.toLowerCase()]
    if (reserveId === undefined) {
      throw new Error(`no reserve id for ${r.underlyingAsset} — id map incomplete`)
    }
    const availableLiquidity =
      r.virtualUnderlyingBalance > 0n ? r.virtualUnderlyingBalance : r.availableLiquidity
    const supplyDisabledReason = !r.isActive
      ? 'reserve inactive'
      : r.isPaused
        ? 'reserve paused'
        : r.isFrozen
          ? 'reserve frozen'
          : !r.usageAsCollateralEnabled
            ? 'not usable as collateral'
            : r.baseLTVasCollateral === 0n
              ? 'zero LTV — no borrowing power'
              : null
    const borrowDisabledReason = !r.isActive
      ? 'reserve inactive'
      : r.isPaused
        ? 'reserve paused'
        : r.isFrozen
          ? 'reserve frozen'
          : !r.borrowingEnabled
            ? 'borrowing disabled'
            : availableLiquidity === 0n
              ? 'no liquidity'
              : null
    return {
      asset: r.underlyingAsset,
      symbol: r.symbol,
      name: r.name,
      decimals: Number(r.decimals),
      reserveId,
      priceBase: r.priceInMarketReferenceCurrency,
      supplyApy: rayRateToApy(r.liquidityRate),
      borrowApy: rayRateToApy(r.variableBorrowRate),
      canSupply: supplyDisabledReason === null,
      canBorrow: borrowDisabledReason === null,
      supplyDisabledReason,
      borrowDisabledReason,
      ltvBps: r.baseLTVasCollateral,
      liquidationThresholdBps: r.reserveLiquidationThreshold,
      availableLiquidity,
      raw: r,
    }
  })
}

export interface PositionView {
  supplied: { asset: MarketAssetView; balance: bigint; balanceBase: bigint; isCollateral: boolean }[]
  borrowed: { asset: MarketAssetView; debt: bigint; debtBase: bigint }[]
  account: ReturnType<typeof computeAccountData>
  eModeCategoryId: number
  eModeLabel: string | null
}

export function buildPositionView(
  market: MarketAssetView[],
  userReserves: UserReserveData[],
  userEModeId: number,
  emodes: EModeCategoryInfo[],
  baseCcy: BaseCurrencyInfo,
): PositionView {
  void baseCcy
  const byAsset = new Map(market.map((a) => [a.asset.toLowerCase(), a]))
  const supplied: PositionView['supplied'] = []
  const borrowed: PositionView['borrowed'] = []
  const legs: AccountLeg[] = []

  for (const ur of userReserves) {
    const asset = byAsset.get(ur.underlyingAsset.toLowerCase())
    if (!asset) continue
    const balance = getATokenBalance(ur.scaledATokenBalance, asset.raw.liquidityIndex)
    const debt = getVTokenBalance(ur.scaledVariableDebt, asset.raw.variableBorrowIndex)
    if (balance > 0n) {
      supplied.push({
        asset,
        balance,
        balanceBase: toBaseCurrency(balance, asset.decimals, asset.priceBase),
        isCollateral: ur.usageAsCollateralEnabledOnUser,
      })
    }
    if (debt > 0n) {
      borrowed.push({ asset, debt, debtBase: toBaseCurrency(debt, asset.decimals, asset.priceBase) })
    }
    const collateralBase =
      ur.usageAsCollateralEnabledOnUser && balance > 0n
        ? toBaseCurrency(balance, asset.decimals, asset.priceBase)
        : 0n
    const debtBase = debt > 0n ? toBaseCurrency(debt, asset.decimals, asset.priceBase) : 0n
    if (collateralBase > 0n || debtBase > 0n) {
      legs.push({
        reserveId: asset.reserveId,
        balanceBase: collateralBase,
        debtBase,
        ltvBps: asset.ltvBps,
        liquidationThresholdBps: asset.liquidationThresholdBps,
      })
    }
  }

  const category = userEModeId !== 0 ? (emodes.find((c) => c.id === userEModeId) ?? null) : null
  const emode: EModeRiskOverride | null = category
    ? {
        categoryId: category.id,
        ltvBps: category.ltvBps,
        liquidationThresholdBps: category.liquidationThresholdBps,
        collateralBitmap: category.collateralBitmap,
        ltvzeroBitmap: category.ltvzeroBitmap,
      }
    : null

  return {
    supplied,
    borrowed,
    account: computeAccountData(legs, emode),
    eModeCategoryId: userEModeId,
    eModeLabel: category?.label ?? null,
  }
}
