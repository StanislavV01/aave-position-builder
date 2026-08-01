import { describe, expect, it } from 'vitest'
import type { Address } from 'viem'
import type { AggregatedReserveData, BaseCurrencyInfo, EModeCategoryInfo, UserReserveData } from '@app/shared'
import { buildMarketView, buildPositionView } from './derived'

const RAY = 10n ** 27n
const MAX_UINT256 = (1n << 256n) - 1n

const WETH = '0x4200000000000000000000000000000000000006' as Address
const USDC = '0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f' as Address

const baseCcy: BaseCurrencyInfo = {
  marketReferenceCurrencyUnit: 10n ** 8n,
  marketReferenceCurrencyPriceInUsd: 10n ** 8n,
  networkBaseTokenPriceInUsd: 2000n * 10n ** 8n,
  networkBaseTokenPriceDecimals: 8,
}

function makeReserve(overrides: Partial<AggregatedReserveData>): AggregatedReserveData {
  return {
    underlyingAsset: WETH,
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18n,
    baseLTVasCollateral: 7500n,
    reserveLiquidationThreshold: 8000n,
    reserveLiquidationBonus: 10500n,
    reserveFactor: 1500n,
    usageAsCollateralEnabled: true,
    borrowingEnabled: true,
    isActive: true,
    isFrozen: false,
    liquidityIndex: RAY,
    variableBorrowIndex: RAY,
    liquidityRate: 0n,
    variableBorrowRate: 0n,
    lastUpdateTimestamp: 1_753_920_000,
    aTokenAddress: '0x0000000000000000000000000000000000000a01' as Address,
    variableDebtTokenAddress: '0x0000000000000000000000000000000000000a02' as Address,
    interestRateStrategyAddress: '0x0000000000000000000000000000000000000a03' as Address,
    availableLiquidity: 100n * 10n ** 18n,
    totalScaledVariableDebt: 0n,
    priceInMarketReferenceCurrency: 2000n * 10n ** 8n,
    priceOracle: '0x0000000000000000000000000000000000000a04' as Address,
    variableRateSlope1: 0n,
    variableRateSlope2: 0n,
    baseVariableBorrowRate: 0n,
    optimalUsageRatio: 0n,
    isPaused: false,
    isSiloedBorrowing: false,
    accruedToTreasury: 0n,
    isolationModeTotalDebt: 0n,
    flashLoanEnabled: true,
    debtCeiling: 0n,
    debtCeilingDecimals: 2n,
    borrowCap: 0n,
    supplyCap: 0n,
    borrowableInIsolation: false,
    virtualUnderlyingBalance: 0n,
    deficit: 0n,
    ...overrides,
  }
}

const wethReserve = makeReserve({})
const usdcReserve = makeReserve({
  underlyingAsset: USDC,
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6n,
  baseLTVasCollateral: 7700n,
  reserveLiquidationThreshold: 7800n,
  priceInMarketReferenceCurrency: 10n ** 8n,
  availableLiquidity: 1_000_000n * 10n ** 6n,
})
const ids = { [WETH.toLowerCase()]: 0, [USDC.toLowerCase()]: 1 }

describe('buildMarketView', () => {
  it('maps fields and flags enabled assets', () => {
    const view = buildMarketView([wethReserve, usdcReserve], baseCcy, ids)
    expect(view).toHaveLength(2)
    const weth = view[0]
    expect(weth.symbol).toBe('WETH')
    expect(weth.decimals).toBe(18)
    expect(weth.reserveId).toBe(0)
    expect(weth.priceBase).toBe(2000n * 10n ** 8n)
    expect(weth.canSupply).toBe(true)
    expect(weth.canBorrow).toBe(true)
    expect(weth.supplyDisabledReason).toBeNull()
    expect(weth.availableLiquidity).toBe(100n * 10n ** 18n)
  })

  it('prefers virtualUnderlyingBalance when non-zero', () => {
    const r = makeReserve({ virtualUnderlyingBalance: 7n * 10n ** 18n })
    const view = buildMarketView([r], baseCcy, { [WETH.toLowerCase()]: 0 })
    expect(view[0].availableLiquidity).toBe(7n * 10n ** 18n)
  })

  it('explains disabled options instead of hiding them', () => {
    const frozen = makeReserve({ isFrozen: true })
    const noBorrow = makeReserve({ underlyingAsset: USDC, borrowingEnabled: false })
    const view = buildMarketView([frozen, noBorrow], baseCcy, ids)
    expect(view[0].canSupply).toBe(false)
    expect(view[0].supplyDisabledReason).toBe('reserve frozen')
    expect(view[1].canBorrow).toBe(false)
    expect(view[1].borrowDisabledReason).toBe('borrowing disabled')
  })

  it('flags LTV-0 collateral as unsupplyable with a reason', () => {
    const ltv0 = makeReserve({ baseLTVasCollateral: 0n })
    const view = buildMarketView([ltv0], baseCcy, { [WETH.toLowerCase()]: 0 })
    expect(view[0].canSupply).toBe(false)
    expect(view[0].supplyDisabledReason).toBe('zero LTV — no borrowing power')
  })

  it('hard-errors when a reserve is missing from the id map', () => {
    expect(() => buildMarketView([wethReserve], baseCcy, {})).toThrow(/no reserve id/)
  })
})

describe('buildPositionView', () => {
  const market = buildMarketView([wethReserve, usdcReserve], baseCcy, ids)

  it('zero debt → HF is max uint256 and empty borrow list', () => {
    const userReserves: UserReserveData[] = [
      { underlyingAsset: WETH, scaledATokenBalance: 10n ** 18n, usageAsCollateralEnabledOnUser: true, scaledVariableDebt: 0n },
    ]
    const view = buildPositionView(market, userReserves, 0, [], baseCcy)
    expect(view.supplied).toHaveLength(1)
    expect(view.supplied[0].balance).toBe(10n ** 18n) // index = RAY → balance == scaled
    expect(view.supplied[0].balanceBase).toBe(2000n * 10n ** 8n)
    expect(view.borrowed).toHaveLength(0)
    expect(view.account.healthFactorWad).toBe(MAX_UINT256)
    expect(view.eModeCategoryId).toBe(0)
    expect(view.eModeLabel).toBeNull()
  })

  it('collateral + debt → HF from per-reserve LT', () => {
    const userReserves: UserReserveData[] = [
      { underlyingAsset: WETH, scaledATokenBalance: 10n ** 18n, usageAsCollateralEnabledOnUser: true, scaledVariableDebt: 0n },
      { underlyingAsset: USDC, scaledATokenBalance: 0n, usageAsCollateralEnabledOnUser: false, scaledVariableDebt: 800n * 10n ** 6n },
    ]
    const view = buildPositionView(market, userReserves, 0, [], baseCcy)
    // HF = 2000e8 * 0.80 / 800e8 = 2.0
    expect(view.account.healthFactorWad).toBe(2n * 10n ** 18n)
    expect(view.borrowed[0].debtBase).toBe(800n * 10n ** 8n)
  })

  it('active eMode substitutes category LT and reports the label', () => {
    const cat: EModeCategoryInfo = {
      id: 1,
      ltvBps: 9000n,
      liquidationThresholdBps: 9300n,
      liquidationBonusBps: 10100n,
      collateralBitmap: 1n << 0n, // WETH (reserve id 0) is in the category
      borrowableBitmap: 1n << 1n,
      ltvzeroBitmap: 0n,
      isolated: false,
      label: 'ETH correlated',
    }
    const userReserves: UserReserveData[] = [
      { underlyingAsset: WETH, scaledATokenBalance: 10n ** 18n, usageAsCollateralEnabledOnUser: true, scaledVariableDebt: 0n },
      { underlyingAsset: USDC, scaledATokenBalance: 0n, usageAsCollateralEnabledOnUser: false, scaledVariableDebt: 800n * 10n ** 6n },
    ]
    const view = buildPositionView(market, userReserves, 1, [cat], baseCcy)
    // HF = 2000e8 * 0.93 / 800e8 = 2.325
    expect(view.account.healthFactorWad).toBe(2_325n * 10n ** 15n)
    expect(view.eModeLabel).toBe('ETH correlated')
  })

  it('LTV-0 collateral contributes LT but zero borrowing power', () => {
    const ltv0Reserve = makeReserve({ baseLTVasCollateral: 0n })
    const m = buildMarketView([ltv0Reserve, usdcReserve], baseCcy, ids)
    const userReserves: UserReserveData[] = [
      { underlyingAsset: WETH, scaledATokenBalance: 10n ** 18n, usageAsCollateralEnabledOnUser: true, scaledVariableDebt: 0n },
    ]
    const view = buildPositionView(m, userReserves, 0, [], baseCcy)
    expect(view.account.hasZeroLtvCollateral).toBe(true)
    expect(view.account.availableBorrowsBase).toBe(0n)
    expect(view.account.totalCollateralBase).toBe(2000n * 10n ** 8n)
  })
})

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeFunctionResult } from 'viem'
import { getEModesAbi, getReservesDataAbi, normalizeEModes } from '@app/shared'

const fixturePath = join(import.meta.dirname, '__fixtures__', 'base-sepolia.json')

// Skips (with a visible reason) only before the one-time capture in Task 14 Step 9 has run.
describe.skipIf(!existsSync(fixturePath))('derived views against captured base-sepolia fixture', () => {
  const fx = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    reservesDataHex: `0x${string}`
    eModesHex: `0x${string}`
    reserveIds: Record<string, number>
  }
  const [reserves, ccy] = decodeFunctionResult({
    abi: getReservesDataAbi('base-sepolia'),
    functionName: 'getReservesData',
    data: fx.reservesDataHex,
  }) as unknown as [AggregatedReserveData[], BaseCurrencyInfo]
  const emodes = normalizeEModes(
    'base-sepolia',
    decodeFunctionResult({ abi: getEModesAbi('base-sepolia'), functionName: 'getEModes', data: fx.eModesHex }),
  )

  it('decodes all Base Sepolia reserves and builds a complete market view', () => {
    const view = buildMarketView([...reserves], ccy, fx.reserveIds)
    expect(view.length).toBeGreaterThanOrEqual(6)
    const weth = view.find((a) => a.asset.toLowerCase() === WETH.toLowerCase())
    expect(weth).toBeDefined()
    expect(weth!.decimals).toBe(18)
    expect(weth!.priceBase).toBeGreaterThan(0n)
    const idSet = new Set(view.map((a) => a.reserveId))
    expect(idSet.size).toBe(view.length) // ids unique
  })

  it('decodes Base Sepolia eModes with the verified 6-field EModeCategory ABI', () => {
    expect(emodes.length).toBeGreaterThanOrEqual(1)
    for (const cat of emodes) {
      expect(cat.isolated).toBe(false) // always false — no `isolated` field on either deployed network
      expect(cat.ltvzeroBitmap).toBe(0n) // no `ltvzeroBitmap` field on Base Sepolia's deployed shape
      expect(cat.liquidationThresholdBps).toBeGreaterThan(0n)
      expect(typeof cat.label).toBe('string')
    }
  })

  it('an empty user reserve set yields an empty position with HF = infinity', () => {
    const view = buildMarketView([...reserves], ccy, fx.reserveIds)
    const userReserves = reserves.map((r) => ({
      underlyingAsset: r.underlyingAsset,
      scaledATokenBalance: 0n,
      usageAsCollateralEnabledOnUser: false,
      scaledVariableDebt: 0n,
    }))
    const pos = buildPositionView(view, userReserves, 0, emodes, ccy)
    expect(pos.supplied).toHaveLength(0)
    expect(pos.borrowed).toHaveLength(0)
    expect(pos.account.healthFactorWad).toBe(MAX_UINT256)
  })
})
