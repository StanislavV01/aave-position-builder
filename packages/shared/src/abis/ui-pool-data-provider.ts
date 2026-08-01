import { parseAbi } from 'viem'
import type { Abi, Address } from 'viem'
import { z } from 'zod'
import type { NetworkKey } from '../networks'

// --- AggregatedReserveData: the plan's original ABIs were vendored from
// aave-v3-origin repo tags (v3.6.0 / main), but the DEPLOYED contracts differ from
// those tags. Ground truth below is verified from Blockscout-verified source for both
// deployed UiPoolDataProviderV3 contracts, and empirically confirmed by decoding a
// captured real getReservesData() payload:
//   - Base Sepolia UI_POOL_DATA_PROVIDER = 0x6a9D64f93DB660EaCB2b6E9424792c630CdA87d8
//   - Base mainnet UI_POOL_DATA_PROVIDER = 0xb84A20e848baE3e13897934bB4e74E2225f4546B
//
// Base mainnet is byte-identical to the vanilla 40-field struct from the repo tags.
// Base Sepolia inserts TWO extra fields not present on mainnet:
//   `uint128 unbacked`        — inserted right after `accruedToTreasury`
//   `bool virtualAccActive`   — inserted right after `borrowableInIsolation`
// for a total of 42 fields. Decoding the Sepolia payload with the vanilla 40-field
// struct throws viem's InvalidBytesBooleanError; decoding the vanilla mainnet payload
// with the 42-field struct would silently misread the tail of the tuple. The two
// networks therefore need two DISTINCT ABIs — there is no shared shape.
const AGGREGATED_RESERVE_DATA_BASE_STRUCT =
  'struct AggregatedReserveData { address underlyingAsset; string name; string symbol; uint256 decimals; uint256 baseLTVasCollateral; uint256 reserveLiquidationThreshold; uint256 reserveLiquidationBonus; uint256 reserveFactor; bool usageAsCollateralEnabled; bool borrowingEnabled; bool isActive; bool isFrozen; uint128 liquidityIndex; uint128 variableBorrowIndex; uint128 liquidityRate; uint128 variableBorrowRate; uint40 lastUpdateTimestamp; address aTokenAddress; address variableDebtTokenAddress; address interestRateStrategyAddress; uint256 availableLiquidity; uint256 totalScaledVariableDebt; uint256 priceInMarketReferenceCurrency; address priceOracle; uint256 variableRateSlope1; uint256 variableRateSlope2; uint256 baseVariableBorrowRate; uint256 optimalUsageRatio; bool isPaused; bool isSiloedBorrowing; uint128 accruedToTreasury; uint128 isolationModeTotalDebt; bool flashLoanEnabled; uint256 debtCeiling; uint256 debtCeilingDecimals; uint256 borrowCap; uint256 supplyCap; bool borrowableInIsolation; uint128 virtualUnderlyingBalance; uint128 deficit; }' as const

const AGGREGATED_RESERVE_DATA_SEPOLIA_STRUCT =
  'struct AggregatedReserveData { address underlyingAsset; string name; string symbol; uint256 decimals; uint256 baseLTVasCollateral; uint256 reserveLiquidationThreshold; uint256 reserveLiquidationBonus; uint256 reserveFactor; bool usageAsCollateralEnabled; bool borrowingEnabled; bool isActive; bool isFrozen; uint128 liquidityIndex; uint128 variableBorrowIndex; uint128 liquidityRate; uint128 variableBorrowRate; uint40 lastUpdateTimestamp; address aTokenAddress; address variableDebtTokenAddress; address interestRateStrategyAddress; uint256 availableLiquidity; uint256 totalScaledVariableDebt; uint256 priceInMarketReferenceCurrency; address priceOracle; uint256 variableRateSlope1; uint256 variableRateSlope2; uint256 baseVariableBorrowRate; uint256 optimalUsageRatio; bool isPaused; bool isSiloedBorrowing; uint128 accruedToTreasury; uint128 unbacked; uint128 isolationModeTotalDebt; bool flashLoanEnabled; uint256 debtCeiling; uint256 debtCeilingDecimals; uint256 borrowCap; uint256 supplyCap; bool borrowableInIsolation; bool virtualAccActive; uint128 virtualUnderlyingBalance; uint128 deficit; }' as const

const BASE_CURRENCY_INFO_STRUCT =
  'struct BaseCurrencyInfoStruct { uint256 marketReferenceCurrencyUnit; int256 marketReferenceCurrencyPriceInUsd; int256 networkBaseTokenPriceInUsd; uint8 networkBaseTokenPriceDecimals; }' as const

const GET_RESERVES_DATA_ABI_BASE = parseAbi([
  AGGREGATED_RESERVE_DATA_BASE_STRUCT,
  BASE_CURRENCY_INFO_STRUCT,
  'function getReservesData(address provider) view returns (AggregatedReserveData[], BaseCurrencyInfoStruct)',
])

const GET_RESERVES_DATA_ABI_SEPOLIA = parseAbi([
  AGGREGATED_RESERVE_DATA_SEPOLIA_STRUCT,
  BASE_CURRENCY_INFO_STRUCT,
  'function getReservesData(address provider) view returns (AggregatedReserveData[], BaseCurrencyInfoStruct)',
])

// getReservesData is the ONLY way to fetch reserve data — pick the ABI matching the
// target network's deployed contract. There is deliberately no shared/default ABI
// for this call; using the wrong one either throws (mainnet ABI on Sepolia payload)
// or silently misdecodes the tuple tail (Sepolia ABI on mainnet payload).
export function getReservesDataAbi(key: NetworkKey): Abi {
  return key === 'base' ? GET_RESERVES_DATA_ABI_BASE : GET_RESERVES_DATA_ABI_SEPOLIA
}

// getUserReservesData and getReservesList are verified identical on both networks —
// safe to share one ABI for these calls.
export const UI_POOL_DATA_PROVIDER_ABI = parseAbi([
  'struct UserReserveDataStruct { address underlyingAsset; uint256 scaledATokenBalance; bool usageAsCollateralEnabledOnUser; uint256 scaledVariableDebt; }',
  'function getReservesList(address provider) view returns (address[])',
  'function getUserReservesData(address provider, address user) view returns (UserReserveDataStruct[], uint8)',
])

// --- getEModes: verified deployed EModeCategory shapes. Like AggregatedReserveData
// above, NEITHER deployed network matches the aave-v3-origin repo tags literally, and
// the two networks do NOT share a shape:
//   - Base mainnet (7 fields, no `isolated`): ltv, liquidationThreshold,
//     liquidationBonus, collateralBitmap, label, borrowableBitmap, ltvzeroBitmap.
//   - Base Sepolia (6 fields): identical to mainnet's 7-field shape MINUS
//     `ltvzeroBitmap` — no `isolated` either.
// History note: an 8-field shape with `bool isolated` inserted between
// collateralBitmap and label (matching aave-v3-origin's v3.7 tag) was the previous
// assumption for Base mainnet. It is NOT deployed on either target network and has
// been removed — do not resurrect it without fresh verified-source evidence.
const EMODE_CATEGORY_BASE_STRUCT =
  'struct EModeCategory { uint16 ltv; uint16 liquidationThreshold; uint16 liquidationBonus; uint128 collateralBitmap; string label; uint128 borrowableBitmap; uint128 ltvzeroBitmap; }' as const

const EMODE_CATEGORY_SEPOLIA_STRUCT =
  'struct EModeCategory { uint16 ltv; uint16 liquidationThreshold; uint16 liquidationBonus; uint128 collateralBitmap; string label; uint128 borrowableBitmap; }' as const

const EMODES_ABI_BASE = parseAbi([
  EMODE_CATEGORY_BASE_STRUCT,
  'struct Emode { uint8 id; EModeCategory eMode; }',
  'function getEModes(address provider) view returns (Emode[])',
])

const EMODES_ABI_SEPOLIA = parseAbi([
  EMODE_CATEGORY_SEPOLIA_STRUCT,
  'struct Emode { uint8 id; EModeCategory eMode; }',
  'function getEModes(address provider) view returns (Emode[])',
])

export function getEModesAbi(key: NetworkKey): Abi {
  return key === 'base' ? EMODES_ABI_BASE : EMODES_ABI_SEPOLIA
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
  /**
   * Verified present ONLY in Base Sepolia decodes (deployed contract adds this field
   * right after `accruedToTreasury`; Base mainnet's deployed contract does not have
   * it). See the deployment-skew comment above `getReservesDataAbi`.
   */
  unbacked?: bigint
  isolationModeTotalDebt: bigint
  flashLoanEnabled: boolean
  debtCeiling: bigint
  debtCeilingDecimals: bigint
  borrowCap: bigint
  supplyCap: bigint
  borrowableInIsolation: boolean
  /**
   * Verified present ONLY in Base Sepolia decodes (deployed contract adds this field
   * right after `borrowableInIsolation`; Base mainnet's deployed contract does not
   * have it). See the deployment-skew comment above `getReservesDataAbi`.
   */
  virtualAccActive?: boolean
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

// Normalized across networks: ltvzeroBitmap and isolated are always present
// (ltvzeroBitmap: 0n and isolated: false when decoding Base Sepolia, which has
// neither field on-chain).
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

// Strict per-network zod shapes: a wrong-network payload must throw loudly, never
// silently decode into a corrupted/defaulted result. The two shapes differ only by
// the presence of `ltvzeroBitmap` (base has it, base-sepolia does not), so `.strict()`
// (rejecting unrecognized keys) is what actually catches base-shaped data misrouted
// through the sepolia schema — a missing required field alone would only catch the
// opposite mistake.
const eModeCategoryBaseSchema = z.strictObject({
  ltv: z.number().int().nonnegative(),
  liquidationThreshold: z.number().int().nonnegative(),
  liquidationBonus: z.number().int().nonnegative(),
  collateralBitmap: z.bigint(),
  label: z.string(),
  borrowableBitmap: z.bigint(),
  ltvzeroBitmap: z.bigint(),
})

const eModeCategorySepoliaSchema = z.strictObject({
  ltv: z.number().int().nonnegative(),
  liquidationThreshold: z.number().int().nonnegative(),
  liquidationBonus: z.number().int().nonnegative(),
  collateralBitmap: z.bigint(),
  label: z.string(),
  borrowableBitmap: z.bigint(),
})

const rawEModesBaseSchema = z.array(
  z.strictObject({ id: z.number().int().nonnegative(), eMode: eModeCategoryBaseSchema }),
)

const rawEModesSepoliaSchema = z.array(
  z.strictObject({ id: z.number().int().nonnegative(), eMode: eModeCategorySepoliaSchema }),
)

interface RawSharedCategory {
  ltv: number
  liquidationThreshold: number
  liquidationBonus: number
  collateralBitmap: bigint
  label: string
  borrowableBitmap: bigint
}

function toCategoryInfo(
  id: number,
  category: RawSharedCategory,
  ltvzeroBitmap: bigint,
  isolated: boolean,
): EModeCategoryInfo {
  return {
    id,
    ltvBps: BigInt(category.ltv),
    liquidationThresholdBps: BigInt(category.liquidationThreshold),
    liquidationBonusBps: BigInt(category.liquidationBonus),
    collateralBitmap: category.collateralBitmap,
    borrowableBitmap: category.borrowableBitmap,
    ltvzeroBitmap,
    isolated,
    label: category.label,
  }
}

export function normalizeEModes(key: NetworkKey, raw: unknown): EModeCategoryInfo[] {
  if (key === 'base') {
    return rawEModesBaseSchema
      .parse(raw)
      .map((entry) => toCategoryInfo(entry.id, entry.eMode, entry.eMode.ltvzeroBitmap, false))
  }
  return rawEModesSepoliaSchema.parse(raw).map((entry) => toCategoryInfo(entry.id, entry.eMode, 0n, false))
}
