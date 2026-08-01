import { describe, expect, it } from 'vitest'
import type { Address } from 'viem'
import { computeAccountData, type EModeCategoryInfo } from '@app/shared'
import type { MarketAssetView, PositionView } from './derived'
import { parseAmount, planOpenPosition, type PlanInputs } from './plan'

const WAD = 10n ** 18n
const WETH = '0x4200000000000000000000000000000000000006' as Address
const USDC = '0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f' as Address
const CBETH = '0xD171b9694f7A2597Ed006D41f7509aaD4B485c4B' as Address

function makeAssetView(over: Partial<MarketAssetView>): MarketAssetView {
  return {
    asset: WETH,
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    reserveId: 0,
    priceBase: 2000n * 10n ** 8n,
    supplyApy: 0.01,
    borrowApy: 0.03,
    canSupply: true,
    canBorrow: true,
    supplyDisabledReason: null,
    borrowDisabledReason: null,
    ltvBps: 7500n,
    liquidationThresholdBps: 8000n,
    availableLiquidity: 1_000_000n * 10n ** 18n,
    raw: {} as MarketAssetView['raw'], // planner never touches raw
    ...over,
  }
}

const weth = makeAssetView({})
const usdc = makeAssetView({
  asset: USDC, symbol: 'USDC', decimals: 6, reserveId: 1,
  priceBase: 10n ** 8n, ltvBps: 7700n, liquidationThresholdBps: 7800n,
  availableLiquidity: 1_000_000n * 10n ** 6n,
})
const cbeth = makeAssetView({
  asset: CBETH, symbol: 'cbETH', decimals: 18, reserveId: 2,
  priceBase: 2000n * 10n ** 8n, ltvBps: 7400n, liquidationThresholdBps: 7700n,
})
const market = [weth, usdc, cbeth]

const ethCorrelated: EModeCategoryInfo = {
  id: 1, ltvBps: 9000n, liquidationThresholdBps: 9300n, liquidationBonusBps: 10100n,
  collateralBitmap: (1n << 0n) | (1n << 2n), borrowableBitmap: (1n << 0n) | (1n << 2n),
  ltvzeroBitmap: 0n, isolated: false, label: 'ETH correlated',
}

function makeInputs(over: Partial<PlanInputs>): PlanInputs {
  return {
    market, position: null, emodes: [],
    collateralAsset: WETH, collateralAmount: 10n ** 18n, walletBalance: 10n * 10n ** 18n,
    borrowAsset: USDC, eModeEnabled: false,
    lastEdited: 'targetHf', targetHfWad: 2n * WAD, borrowAmount: 0n,
    ...over,
  }
}

describe('parseAmount', () => {
  it('parses decimals, empty is zero, junk is -1n', () => {
    expect(parseAmount('1.5', 6)).toBe(1_500_000n)
    expect(parseAmount('', 6)).toBe(0n)
    expect(parseAmount('abc', 6)).toBe(-1n)
  })
})

describe('planOpenPosition', () => {
  it('derives borrow amount from target HF (1 WETH @ $2000, LT 80%, target 2.0 → 800 USDC)', () => {
    const plan = planOpenPosition(makeInputs({}))
    expect(plan.valid).toBe(true)
    expect(plan.borrow?.amount).toBe(800_000_000n)
    expect(plan.predictedHfWad).toBe(2n * WAD)
    expect(plan.bindingConstraint).toBe('ltv') // LTV max 1500 USDC < 1M liquidity
    expect(plan.maxBorrow).toBe(1_500_000_000n)
    expect(plan.warnLowHf).toBe(false)
    expect(plan.eModeCategoryToSet).toBeNull()
  })

  it('shared eMode category raises LT in the simulation and is recommended', () => {
    const plan = planOpenPosition(
      makeInputs({ borrowAsset: CBETH, emodes: [ethCorrelated], eModeEnabled: true }),
    )
    expect(plan.eModeCandidate?.id).toBe(1)
    expect(plan.eModeRecommended).toBe(true) // 90% > 75%
    expect(plan.eModeCategoryToSet).toBe(1)
    // target 2.0 with LT 93%: debtBase = 2000e8*9300/(2*1e4) = 930e8 → 0.465 cbETH
    expect(plan.borrow?.amount).toBe(465_000_000_000_000_000n)
    expect(plan.predictedHfWad).toBe(2n * WAD)
  })

  it('toggle off keeps the candidate visible but does not set eMode', () => {
    const plan = planOpenPosition(
      makeInputs({ borrowAsset: CBETH, emodes: [ethCorrelated], eModeEnabled: false }),
    )
    expect(plan.eModeCandidate?.id).toBe(1)
    expect(plan.eModeCategoryToSet).toBeNull()
    // simulated with base LT 80%: 2000e8*8000/(2e4) = 800e8 → 0.4 cbETH
    expect(plan.borrow?.amount).toBe(400_000_000_000_000_000n)
  })

  it('borrow-amount editing flows back into HF and flags the warning zone', () => {
    const plan = planOpenPosition(
      makeInputs({ lastEdited: 'borrowAmount', borrowAmount: 1_500_000_000n }),
    )
    expect(plan.valid).toBe(true)
    expect(plan.capped).toBe(false)
    // HF = 2000e8*0.80/1500e8 ≈ 1.0667
    expect(plan.predictedHfWad!).toBeGreaterThan(106n * 10n ** 16n)
    expect(plan.predictedHfWad!).toBeLessThan(107n * 10n ** 16n)
    expect(plan.warnLowHf).toBe(true)
  })

  it('caps at available liquidity and names the constraint', () => {
    const dryUsdc = { ...usdc, availableLiquidity: 100_000_000n } // 100 USDC left
    const plan = planOpenPosition(
      makeInputs({ market: [weth, dryUsdc, cbeth], lastEdited: 'borrowAmount', borrowAmount: 200_000_000n }),
    )
    expect(plan.bindingConstraint).toBe('liquidity')
    expect(plan.maxBorrow).toBe(100_000_000n)
    expect(plan.capped).toBe(true)
    expect(plan.borrow?.amount).toBe(100_000_000n)
  })

  it('hard-blocks HF <= 1.0', () => {
    const degenerate = makeAssetView({ ltvBps: 9900n, liquidationThresholdBps: 9900n })
    const plan = planOpenPosition(
      makeInputs({ market: [degenerate, usdc, cbeth], lastEdited: 'borrowAmount', borrowAmount: 1_980_000_000n }),
    )
    expect(plan.predictedHfWad).toBe(WAD) // exactly 1.0
    expect(plan.valid).toBe(false)
    expect(plan.reasons.join(' ')).toMatch(/health factor/)
  })

  it('rejects collateral above wallet balance', () => {
    const plan = planOpenPosition(makeInputs({ collateralAmount: 2n * 10n ** 18n, walletBalance: 10n ** 18n }))
    expect(plan.valid).toBe(false)
    expect(plan.reasons.join(' ')).toMatch(/wallet balance/)
  })

  it('merges an existing position into the simulation', () => {
    const account = computeAccountData(
      [{ reserveId: 0, balanceBase: 2000n * 10n ** 8n, debtBase: 0n, ltvBps: 7500n, liquidationThresholdBps: 8000n },
       { reserveId: 1, balanceBase: 0n, debtBase: 800n * 10n ** 8n, ltvBps: 7700n, liquidationThresholdBps: 7800n }],
      null,
    )
    const position: PositionView = {
      supplied: [{ asset: weth, balance: 10n ** 18n, balanceBase: 2000n * 10n ** 8n, isCollateral: true }],
      borrowed: [{ asset: usdc, debt: 800_000_000n, debtBase: 800n * 10n ** 8n }],
      account, eModeCategoryId: 0, eModeLabel: null,
    }
    // add 1 more WETH, target 2.0 → total allowed debt 1600e8, existing 800e8 → borrow 800 more USDC
    const plan = planOpenPosition(makeInputs({ position }))
    expect(plan.borrow?.amount).toBe(800_000_000n)
    expect(plan.predictedHfWad).toBe(2n * WAD)
  })

  it('missing selection returns a single actionable reason', () => {
    const plan = planOpenPosition(makeInputs({ collateralAsset: null }))
    expect(plan.valid).toBe(false)
    expect(plan.reasons).toEqual(['pick a collateral asset and a borrow asset'])
  })
})
