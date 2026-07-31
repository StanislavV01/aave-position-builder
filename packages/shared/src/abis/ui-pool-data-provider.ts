import { parseAbi } from 'viem'
import type { Abi, Address } from 'viem'
import { z } from 'zod'
import type { NetworkKey } from '../networks'

// --- Shared across v3.6 and v3.7 (verified byte-identical in aave-v3-origin) ---
const AGGREGATED_RESERVE_DATA_STRUCT =
  'struct AggregatedReserveData { address underlyingAsset; string name; string symbol; uint256 decimals; uint256 baseLTVasCollateral; uint256 reserveLiquidationThreshold; uint256 reserveLiquidationBonus; uint256 reserveFactor; bool usageAsCollateralEnabled; bool borrowingEnabled; bool isActive; bool isFrozen; uint128 liquidityIndex; uint128 variableBorrowIndex; uint128 liquidityRate; uint128 variableBorrowRate; uint40 lastUpdateTimestamp; address aTokenAddress; address variableDebtTokenAddress; address interestRateStrategyAddress; uint256 availableLiquidity; uint256 totalScaledVariableDebt; uint256 priceInMarketReferenceCurrency; address priceOracle; uint256 variableRateSlope1; uint256 variableRateSlope2; uint256 baseVariableBorrowRate; uint256 optimalUsageRatio; bool isPaused; bool isSiloedBorrowing; uint128 accruedToTreasury; uint128 isolationModeTotalDebt; bool flashLoanEnabled; uint256 debtCeiling; uint256 debtCeilingDecimals; uint256 borrowCap; uint256 supplyCap; bool borrowableInIsolation; uint128 virtualUnderlyingBalance; uint128 deficit; }' as const

export const UI_POOL_DATA_PROVIDER_ABI = parseAbi([
  AGGREGATED_RESERVE_DATA_STRUCT,
  'struct BaseCurrencyInfoStruct { uint256 marketReferenceCurrencyUnit; int256 marketReferenceCurrencyPriceInUsd; int256 networkBaseTokenPriceInUsd; uint8 networkBaseTokenPriceDecimals; }',
  'struct UserReserveDataStruct { address underlyingAsset; uint256 scaledATokenBalance; bool usageAsCollateralEnabledOnUser; uint256 scaledVariableDebt; }',
  'function getReservesList(address provider) view returns (address[])',
  'function getReservesData(address provider) view returns (AggregatedReserveData[], BaseCurrencyInfoStruct)',
  'function getUserReservesData(address provider, address user) view returns (UserReserveDataStruct[], uint8)',
])

// --- getEModes: THE one place the networks differ. v3.7 inserts `bool isolated`
// between collateralBitmap and label. `string label` makes the tuple dynamic, so
// cross-decoding corrupts/reverts. One ABI per network, selected by getEModesAbi. ---
const EMODES_ABI_V36 = parseAbi([
  'struct EModeCategoryV36 { uint16 ltv; uint16 liquidationThreshold; uint16 liquidationBonus; uint128 collateralBitmap; string label; uint128 borrowableBitmap; uint128 ltvzeroBitmap; }',
  'struct EmodeV36 { uint8 id; EModeCategoryV36 eMode; }',
  'function getEModes(address provider) view returns (EmodeV36[])',
])

const EMODES_ABI_V37 = parseAbi([
  'struct EModeCategoryV37 { uint16 ltv; uint16 liquidationThreshold; uint16 liquidationBonus; uint128 collateralBitmap; bool isolated; string label; uint128 borrowableBitmap; uint128 ltvzeroBitmap; }',
  'struct EmodeV37 { uint8 id; EModeCategoryV37 eMode; }',
  'function getEModes(address provider) view returns (EmodeV37[])',
])

export function getEModesAbi(key: NetworkKey): Abi {
  return key === 'base' ? EMODES_ABI_V37 : EMODES_ABI_V36
}

// --- Decoded shapes (viem named-tuple output) ---
export interface AggregatedReserveData {
  underlyingAsset: Address
  name: string
  symbol: string
  decimals: bigint
  baseLTVasCollateral: bigint
  reserveLiquidationThreshold: bigint
  reserveLiquidationBonus: bigint
  reserveFactor: bigint
  usageAsCollateralEnabled: boolean
  borrowingEnabled: boolean
  isActive: boolean
  isFrozen: boolean
  liquidityIndex: bigint
  variableBorrowIndex: bigint
  liquidityRate: bigint
  variableBorrowRate: bigint
  lastUpdateTimestamp: number
  aTokenAddress: Address
  variableDebtTokenAddress: Address
  interestRateStrategyAddress: Address
  availableLiquidity: bigint
  totalScaledVariableDebt: bigint
  priceInMarketReferenceCurrency: bigint
  priceOracle: Address
  variableRateSlope1: bigint
  variableRateSlope2: bigint
  baseVariableBorrowRate: bigint
  optimalUsageRatio: bigint
  isPaused: boolean
  isSiloedBorrowing: boolean
  accruedToTreasury: bigint
  isolationModeTotalDebt: bigint
  flashLoanEnabled: boolean
  debtCeiling: bigint
  debtCeilingDecimals: bigint
  borrowCap: bigint
  supplyCap: bigint
  borrowableInIsolation: boolean
  virtualUnderlyingBalance: bigint
  deficit: bigint
}

export interface UserReserveData {
  underlyingAsset: Address
  scaledATokenBalance: bigint
  usageAsCollateralEnabledOnUser: boolean
  scaledVariableDebt: bigint
}

export interface BaseCurrencyInfo {
  marketReferenceCurrencyUnit: bigint
  marketReferenceCurrencyPriceInUsd: bigint
  networkBaseTokenPriceInUsd: bigint
  networkBaseTokenPriceDecimals: number
}

// Normalized across versions: isolated is always present (false when decoding v3.6).
export interface EModeCategoryInfo {
  id: number
  ltvBps: bigint
  liquidationThresholdBps: bigint
  liquidationBonusBps: bigint
  collateralBitmap: bigint
  borrowableBitmap: bigint
  ltvzeroBitmap: bigint
  isolated: boolean
  label: string
}

const eModeCategorySharedShape = {
  ltv: z.number().int().nonnegative(),
  liquidationThreshold: z.number().int().nonnegative(),
  liquidationBonus: z.number().int().nonnegative(),
  collateralBitmap: z.bigint(),
  label: z.string(),
  borrowableBitmap: z.bigint(),
  ltvzeroBitmap: z.bigint(),
}

const rawEModesV36Schema = z.array(
  z.object({ id: z.number().int().nonnegative(), eMode: z.object(eModeCategorySharedShape) }),
)

const rawEModesV37Schema = z.array(
  z.object({
    id: z.number().int().nonnegative(),
    eMode: z.object({ ...eModeCategorySharedShape, isolated: z.boolean() }),
  }),
)

interface RawSharedCategory {
  ltv: number
  liquidationThreshold: number
  liquidationBonus: number
  collateralBitmap: bigint
  label: string
  borrowableBitmap: bigint
  ltvzeroBitmap: bigint
}

function toCategoryInfo(id: number, category: RawSharedCategory, isolated: boolean): EModeCategoryInfo {
  return {
    id,
    ltvBps: BigInt(category.ltv),
    liquidationThresholdBps: BigInt(category.liquidationThreshold),
    liquidationBonusBps: BigInt(category.liquidationBonus),
    collateralBitmap: category.collateralBitmap,
    borrowableBitmap: category.borrowableBitmap,
    ltvzeroBitmap: category.ltvzeroBitmap,
    isolated,
    label: category.label,
  }
}

export function normalizeEModes(key: NetworkKey, raw: unknown): EModeCategoryInfo[] {
  if (key === 'base') {
    return rawEModesV37Schema
      .parse(raw)
      .map((entry) => toCategoryInfo(entry.id, entry.eMode, entry.eMode.isolated))
  }
  return rawEModesV36Schema.parse(raw).map((entry) => toCategoryInfo(entry.id, entry.eMode, false))
}
