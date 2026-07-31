import { AaveV3Base, AaveV3BaseSepolia, MiscBaseSepolia } from '@bgd-labs/aave-address-book'
import type { Address } from 'viem'

export type NetworkKey = 'base' | 'base-sepolia'

export interface MarketConfig {
  networkKey: NetworkKey
  chainId: 8453 | 84532
  chainName: string
  pool: Address
  poolAddressesProvider: Address
  uiPoolDataProvider: Address
  oracle: Address
  faucet: Address | null
  expectedPoolRevision: bigint
  protocolVersion: 'v3.6' | 'v3.7'
}

// Addresses come EXCLUSIVELY from the pinned address book — never hardcode them here.
// Base Sepolia: core market only. AaveV3BaseSepoliaLido exists in the book and must NOT be used.
export const MARKETS: readonly MarketConfig[] = [
  {
    networkKey: 'base',
    chainId: 8453,
    chainName: 'Base',
    pool: AaveV3Base.POOL,
    poolAddressesProvider: AaveV3Base.POOL_ADDRESSES_PROVIDER,
    uiPoolDataProvider: AaveV3Base.UI_POOL_DATA_PROVIDER,
    oracle: AaveV3Base.ORACLE,
    faucet: null,
    expectedPoolRevision: 11n,
    protocolVersion: 'v3.7',
  },
  {
    networkKey: 'base-sepolia',
    chainId: 84532,
    chainName: 'Base Sepolia',
    pool: AaveV3BaseSepolia.POOL,
    poolAddressesProvider: AaveV3BaseSepolia.POOL_ADDRESSES_PROVIDER,
    uiPoolDataProvider: AaveV3BaseSepolia.UI_POOL_DATA_PROVIDER,
    oracle: AaveV3BaseSepolia.ORACLE,
    faucet: MiscBaseSepolia.FAUCET,
    expectedPoolRevision: 10n,
    protocolVersion: 'v3.6',
  },
]

export function marketByChainId(chainId: number): MarketConfig | undefined {
  return MARKETS.find((m) => m.chainId === chainId)
}

export function marketByNetworkKey(key: NetworkKey): MarketConfig {
  const market = MARKETS.find((m) => m.networkKey === key)
  if (market === undefined) {
    throw new Error(`Unknown network key: ${String(key)}`)
  }
  return market
}

export function isNetworkKey(s: string): s is NetworkKey {
  return s === 'base' || s === 'base-sepolia'
}
