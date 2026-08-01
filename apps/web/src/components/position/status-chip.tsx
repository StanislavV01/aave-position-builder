import { useQuery } from '@tanstack/react-query'
import { useConfig } from 'wagmi'
import { readContract } from 'wagmi/actions'
import { POOL_ABI, marketByChainId } from '@app/shared'

export type ChipStatus = 'live' | 'degraded' | 'disconnected'

const STATUS_TONE = { live: 'good', degraded: 'warn', disconnected: 'danger' } as const

export function StatusChip({ status, lastEventAtMs }: { status: ChipStatus; lastEventAtMs: number | null }) {
  const label =
    status === 'live' ? 'Live' : status === 'degraded' ? 'Degraded — polling every 5s' : 'Disconnected — polling every 5s'
  return (
    <span className="status-chip" data-tone={STATUS_TONE[status]}>
      {label}
      {lastEventAtMs !== null ? (
        <span className="muted tabular">· last event {Math.max(0, Math.round((Date.now() - lastEventAtMs) / 1000))}s ago</span>
      ) : null}
    </span>
  )
}

export function PoolRevisionNote({ chainId }: { chainId: number }) {
  const config = useConfig()
  const market = marketByChainId(chainId)
  const revision = useQuery({
    queryKey: ['poolRevision', chainId],
    staleTime: Infinity,
    enabled: market !== undefined,
    queryFn: async (): Promise<bigint> => {
      if (!market) throw new Error(`unsupported chain ${chainId}`)
      return (await readContract(config, {
        chainId: market.chainId,
        address: market.pool,
        abi: POOL_ABI,
        functionName: 'POOL_REVISION',
      })) as bigint
    },
  })
  if (!market || revision.data === undefined) return null
  if (revision.data === BigInt(market.expectedPoolRevision)) return null
  return (
    <span className="tone-chip" data-tone="warn">
      Pool revision {revision.data.toString()} on-chain, expected {market.expectedPoolRevision} — testnet may have been upgraded
    </span>
  )
}
