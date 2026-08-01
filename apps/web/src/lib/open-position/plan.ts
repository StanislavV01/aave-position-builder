import { parseUnits, type Address } from 'viem'
import { useMemo } from 'react'
import { useAccount } from 'wagmi'
import {
  borrowAmountBaseForTargetHF,
  computeAccountData,
  findSharedEModeCategories,
  fromBaseCurrency,
  healthFactorAfterBorrow,
  toBaseCurrency,
  type AccountLeg,
  type EModeCategoryInfo,
  type EModeRiskOverride,
} from '@app/shared'
import { buildMarketView, buildPositionView, type MarketAssetView, type PositionView } from '../data/derived'
import { useEModes, useReserveIds, useReservesData, useUserReservesData } from '../data/market-queries'
import { useTokenState } from '../data/token-queries'

const WAD = 10n ** 18n
const WARN_HF_WAD = 11n * 10n ** 17n

/** '' → 0n; unparseable → -1n (callers surface a reason, never throw). */
export function parseAmount(text: string, decimals: number): bigint {
  const trimmed = text.trim()
  if (trimmed === '') return 0n
  try {
    const v = parseUnits(trimmed, decimals)
    return v < 0n ? -1n : v
  } catch {
    return -1n
  }
}

export interface PlanInputs {
  market: MarketAssetView[]
  position: PositionView | null
  emodes: EModeCategoryInfo[]
  collateralAsset: Address | null
  collateralAmount: bigint
  walletBalance: bigint
  borrowAsset: Address | null
  eModeEnabled: boolean
  lastEdited: 'targetHf' | 'borrowAmount'
  targetHfWad: bigint
  borrowAmount: bigint
}

export interface OpenPositionPlan {
  valid: boolean
  reasons: string[]
  collateral: { asset: MarketAssetView; amount: bigint; amountBase: bigint } | null
  borrow: { asset: MarketAssetView; amount: bigint; amountBase: bigint } | null
  eModeCandidate: EModeCategoryInfo | null
  eModeRecommended: boolean
  eModeCategoryToSet: number | null
  predictedHfWad: bigint | null
  maxBorrow: bigint
  bindingConstraint: 'ltv' | 'liquidity' | null
  capped: boolean
  warnLowHf: boolean
}

function emptyPlan(reasons: string[]): OpenPositionPlan {
  return {
    valid: false, reasons, collateral: null, borrow: null,
    eModeCandidate: null, eModeRecommended: false, eModeCategoryToSet: null,
    predictedHfWad: null, maxBorrow: 0n, bindingConstraint: null, capped: false, warnLowHf: false,
  }
}

export function planOpenPosition(inputs: PlanInputs): OpenPositionPlan {
  const findAsset = (a: Address | null) =>
    a ? (inputs.market.find((m) => m.asset.toLowerCase() === a.toLowerCase()) ?? null) : null
  const collateralView = findAsset(inputs.collateralAsset)
  const borrowView = findAsset(inputs.borrowAsset)
  if (!collateralView || !borrowView) return emptyPlan(['pick a collateral asset and a borrow asset'])

  const reasons: string[] = []
  if (!collateralView.canSupply) reasons.push(`cannot supply ${collateralView.symbol}: ${collateralView.supplyDisabledReason}`)
  if (!borrowView.canBorrow) reasons.push(`cannot borrow ${borrowView.symbol}: ${borrowView.borrowDisabledReason}`)
  if (inputs.collateralAmount < 0n) reasons.push('invalid collateral amount')
  else if (inputs.collateralAmount === 0n) reasons.push('enter a collateral amount')
  else if (inputs.collateralAmount > inputs.walletBalance) reasons.push('collateral amount exceeds wallet balance')
  if (inputs.lastEdited === 'borrowAmount' && inputs.borrowAmount < 0n) reasons.push('invalid borrow amount')

  const collateralAmount = inputs.collateralAmount > 0n ? inputs.collateralAmount : 0n

  // Existing position → account legs (local accumulators; nothing shared is mutated).
  const legMap = new Map<number, AccountLeg>()
  const legFor = (asset: MarketAssetView): AccountLeg => {
    const existing = legMap.get(asset.reserveId)
    if (existing) return existing
    const leg: AccountLeg = {
      reserveId: asset.reserveId, balanceBase: 0n, debtBase: 0n,
      ltvBps: asset.ltvBps, liquidationThresholdBps: asset.liquidationThresholdBps,
    }
    legMap.set(asset.reserveId, leg)
    return leg
  }
  for (const s of inputs.position?.supplied ?? []) {
    if (s.isCollateral) legFor(s.asset).balanceBase += s.balanceBase
  }
  for (const b of inputs.position?.borrowed ?? []) {
    legFor(b.asset).debtBase += b.debtBase
  }
  const collateralAmountBase = toBaseCurrency(collateralAmount, collateralView.decimals, collateralView.priceBase)
  legFor(collateralView).balanceBase += collateralAmountBase
  const legs = [...legMap.values()]

  // eMode: shared categories where the collateral bit AND the borrowable bit are both set.
  const currentEModeId = inputs.position?.eModeCategoryId ?? 0
  let eModeCandidate: EModeCategoryInfo | null = null
  let eModeRecommended = false
  let eModeCategoryToSet: number | null = null
  let activeCategory: EModeCategoryInfo | null = null
  if (currentEModeId !== 0) {
    // P0: never switch an existing eMode from the open flow — simulate with the active category.
    activeCategory = inputs.emodes.find((c) => c.id === currentEModeId) ?? null
  } else {
    const candidates = findSharedEModeCategories(collateralView.reserveId, borrowView.reserveId, inputs.emodes)
    const best = candidates.reduce<EModeCategoryInfo | null>(
      (acc, c) => (acc === null || c.ltvBps > acc.ltvBps ? c : acc),
      null,
    )
    if (best) {
      eModeCandidate = best
      eModeRecommended = best.ltvBps > collateralView.ltvBps
      // Defensive: only ever set eMode when it strictly improves LTV, even if the
      // caller passes eModeEnabled=true for a non-improving candidate (the form
      // gates the toggle on eModeRecommended, but the pure core re-checks it too).
      if (inputs.eModeEnabled && eModeRecommended) {
        activeCategory = best
        eModeCategoryToSet = best.id
      }
    }
  }
  const emode: EModeRiskOverride | null = activeCategory
    ? {
        categoryId: activeCategory.id,
        ltvBps: activeCategory.ltvBps,
        liquidationThresholdBps: activeCategory.liquidationThresholdBps,
        collateralBitmap: activeCategory.collateralBitmap,
        ltvzeroBitmap: activeCategory.ltvzeroBitmap,
      }
    : null

  // Sizing: last-edited-wins.
  let borrowAmount: bigint
  if (inputs.lastEdited === 'targetHf') {
    const extraDebtBase = borrowAmountBaseForTargetHF(legs, emode, inputs.targetHfWad)
    borrowAmount = fromBaseCurrency(extraDebtBase, borrowView.decimals, borrowView.priceBase)
  } else {
    borrowAmount = inputs.borrowAmount > 0n ? inputs.borrowAmount : 0n
  }

  // Cap: min(LTV borrowing power, available liquidity) — P0 min-set.
  const account = computeAccountData(legs, emode)
  const maxByLtv = fromBaseCurrency(account.availableBorrowsBase, borrowView.decimals, borrowView.priceBase)
  const maxByLiquidity = borrowView.availableLiquidity
  const maxBorrow = maxByLtv <= maxByLiquidity ? maxByLtv : maxByLiquidity
  const bindingConstraint: 'ltv' | 'liquidity' = maxByLtv <= maxByLiquidity ? 'ltv' : 'liquidity'
  let capped = false
  if (borrowAmount > maxBorrow) {
    borrowAmount = maxBorrow
    capped = true
  }
  if (borrowAmount === 0n) reasons.push('nothing to borrow — increase collateral or lower the target health factor')

  const borrowAmountBase = toBaseCurrency(borrowAmount, borrowView.decimals, borrowView.priceBase)
  const predictedHfWad = healthFactorAfterBorrow(legs, emode, borrowAmountBase)
  if (borrowAmount > 0n && predictedHfWad <= WAD) reasons.push('health factor must stay above 1.0 — lower the borrow amount')
  const warnLowHf = predictedHfWad > WAD && predictedHfWad < WARN_HF_WAD

  return {
    valid: reasons.length === 0,
    reasons,
    collateral: { asset: collateralView, amount: collateralAmount, amountBase: collateralAmountBase },
    borrow: { asset: borrowView, amount: borrowAmount, amountBase: borrowAmountBase },
    eModeCandidate,
    eModeRecommended,
    eModeCategoryToSet,
    predictedHfWad,
    maxBorrow,
    bindingConstraint,
    capped,
    warnLowHf,
  }
}

export interface OpenPositionFormInput {
  chainId: number
  collateralAsset: Address | null
  borrowAsset: Address | null
  collateralAmountText: string
  borrowAmountText: string
  lastEdited: 'targetHf' | 'borrowAmount'
  targetHfWad: bigint
  eModeEnabled: boolean
}

/** Thin wrapper: gathers query data, parses text at the edge, calls the pure core. */
export function useOpenPositionPlan(form: OpenPositionFormInput) {
  const { address } = useAccount()
  const reserves = useReservesData(form.chainId)
  const reserveIds = useReserveIds(form.chainId)
  const emodes = useEModes(form.chainId)
  const userReserves = useUserReservesData(form.chainId, address)
  const tokenState = useTokenState(form.chainId, address, form.collateralAsset ?? undefined)

  // Error only when there is nothing to plan with — same stale-data-wins rule as the
  // panes: a failed refetch over existing data keeps the form working.
  const dataError =
    (!reserves.data && reserves.isError) ||
    (!reserveIds.data && reserveIds.isError) ||
    (!emodes.data && emodes.isError)
  const refetchMarketData = () => {
    void reserves.refetch()
    void reserveIds.refetch()
    void emodes.refetch()
  }

  const derived = useMemo(() => {
    if (!reserves.data || !reserveIds.data || !emodes.data) {
      return { plan: null, collateralView: null, borrowView: null, walletBalance: 0n, isLoading: true as const }
    }
    const market = buildMarketView(reserves.data.reserves, reserves.data.baseCurrency, reserveIds.data)
    const position = userReserves.data
      ? buildPositionView(
          market,
          userReserves.data.userReserves,
          userReserves.data.userEModeCategoryId,
          emodes.data,
          reserves.data.baseCurrency,
        )
      : null
    const findAsset = (a: Address | null) =>
      a ? (market.find((m) => m.asset.toLowerCase() === a.toLowerCase()) ?? null) : null
    const collateralView = findAsset(form.collateralAsset)
    const borrowView = findAsset(form.borrowAsset)
    const walletBalance = tokenState.data?.balance ?? 0n
    const plan = planOpenPosition({
      market,
      position,
      emodes: emodes.data,
      collateralAsset: form.collateralAsset,
      collateralAmount: collateralView ? parseAmount(form.collateralAmountText, collateralView.decimals) : 0n,
      walletBalance,
      borrowAsset: form.borrowAsset,
      eModeEnabled: form.eModeEnabled,
      lastEdited: form.lastEdited,
      targetHfWad: form.targetHfWad,
      borrowAmount: borrowView ? parseAmount(form.borrowAmountText, borrowView.decimals) : 0n,
    })
    return { plan, collateralView, borrowView, walletBalance, isLoading: false as const }
  }, [
    reserves.data, reserveIds.data, emodes.data, userReserves.data, tokenState.data,
    form.chainId, form.collateralAsset, form.borrowAsset, form.collateralAmountText,
    form.borrowAmountText, form.lastEdited, form.targetHfWad, form.eModeEnabled,
  ])

  return { ...derived, dataError, refetchMarketData }
}
