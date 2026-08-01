import { useQuery } from '@tanstack/react-query'
import { useConfig } from 'wagmi'
import { multicall, readContract } from 'wagmi/actions'
import type { Address } from 'viem'
import {
  POOL_ABI,
  UI_POOL_DATA_PROVIDER_ABI,
  getEModesAbi,
  getReservesDataAbi,
  marketByChainId,
  normalizeEModes,
  type AggregatedReserveData,
  type BaseCurrencyInfo,
  type EModeCategoryInfo,
  type UserReserveData,
} from '@app/shared'

export interface ReservesDataResult {
  reserves: AggregatedReserveData[]
  baseCurrency: BaseCurrencyInfo
}

export function useReservesData(chainId: number, pollMs: number | false = false) {
  const config = useConfig()
  const market = marketByChainId(chainId)
  return useQuery({
    queryKey: ['reservesData', chainId],
    staleTime: 10_000,
    refetchInterval: pollMs,
    enabled: market !== undefined,
    queryFn: async (): Promise<ReservesDataResult> => {
      if (!market) throw new Error(`unsupported chain ${chainId}`)
      const result = (await readContract(config, {
        chainId: market.chainId,
        address: market.uiPoolDataProvider,
        abi: getReservesDataAbi(market.networkKey),
        functionName: 'getReservesData',
        args: [market.poolAddressesProvider],
      })) as unknown as readonly [readonly AggregatedReserveData[], BaseCurrencyInfo]
      return { reserves: [...result[0]], baseCurrency: result[1] }
    },
  })
}

export interface UserReservesResult {
  userReserves: UserReserveData[]
  userEModeCategoryId: number
}

export function useUserReservesData(
  chainId: number,
  address: Address | undefined,
  pollMs: number | false = false,
) {
  const config = useConfig()
  const market = marketByChainId(chainId)
  return useQuery({
    queryKey: ['userReservesData', chainId, address],
    staleTime: 10_000,
    refetchInterval: pollMs,
    enabled: market !== undefined && address !== undefined,
    queryFn: async (): Promise<UserReservesResult> => {
      if (!market || !address) throw new Error('query disabled')
      const result = (await readContract(config, {
        chainId: market.chainId,
        address: market.uiPoolDataProvider,
        abi: UI_POOL_DATA_PROVIDER_ABI,
        functionName: 'getUserReservesData',
        args: [market.poolAddressesProvider, address],
      })) as unknown as readonly [readonly UserReserveData[], number]
      return { userReserves: [...result[0]], userEModeCategoryId: Number(result[1]) }
    },
  })
}

export function useEModes(chainId: number) {
  const config = useConfig()
  const market = marketByChainId(chainId)
  return useQuery({
    queryKey: ['eModes', chainId],
    staleTime: 60_000,
    enabled: market !== undefined,
    queryFn: async (): Promise<EModeCategoryInfo[]> => {
      if (!market) throw new Error(`unsupported chain ${chainId}`)
      const raw = await readContract(config, {
        chainId: market.chainId,
        address: market.uiPoolDataProvider,
        abi: getEModesAbi(market.networkKey),
        functionName: 'getEModes',
        args: [market.poolAddressesProvider],
      })
      return normalizeEModes(market.networkKey, raw)
    },
  })
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * True reserve ids. Pool.getReservesList() COMPACTS dropped reserves, so
 * "array index == id" is only true if nothing was ever dropped. eMode bitmaps
 * index by TRUE id, so we resolve ids via getReserveAddressById(0..len+7)
 * through Multicall3 and hard-error if any listed reserve is missing.
 */
export function useReserveIds(chainId: number) {
  const config = useConfig()
  const market = marketByChainId(chainId)
  return useQuery({
    queryKey: ['reserveIds', chainId],
    staleTime: Infinity,
    enabled: market !== undefined,
    queryFn: async (): Promise<Record<string, number>> => {
      if (!market) throw new Error(`unsupported chain ${chainId}`)
      const list = (await readContract(config, {
        chainId: market.chainId,
        address: market.uiPoolDataProvider,
        abi: UI_POOL_DATA_PROVIDER_ABI,
        functionName: 'getReservesList',
        args: [market.poolAddressesProvider],
      })) as unknown as readonly Address[]
      const probeCount = list.length + 8
      const results = (await multicall(config, {
        chainId: market.chainId,
        allowFailure: false,
        contracts: Array.from({ length: probeCount }, (_, id) => ({
          address: market.pool,
          abi: POOL_ABI,
          functionName: 'getReserveAddressById',
          args: [id],
        })),
      })) as unknown as readonly Address[]
      const ids: Record<string, number> = {}
      results.forEach((addr, id) => {
        if (addr.toLowerCase() !== ZERO_ADDRESS) ids[addr.toLowerCase()] = id
      })
      for (const asset of list) {
        if (ids[asset.toLowerCase()] === undefined) {
          throw new Error(
            `reserve id map incomplete: ${asset} is in getReservesList but not found via getReserveAddressById(0..${probeCount - 1})`,
          )
        }
      }
      return ids
    },
  })
}
