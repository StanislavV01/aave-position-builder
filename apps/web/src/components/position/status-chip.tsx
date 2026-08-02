import { useEffect, useReducer } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConfig } from 'wagmi'
import { readContract } from 'wagmi/actions'
import { POOL_ABI, marketByChainId } from '@app/shared'

export type ChipStatus = 'live' | 'degraded' | 'disconnected' | 'connecting'

const STATUS_TONE = { live: 'good', degraded: 'warn', disconnected: 'danger', connecting: 'neutral' } as const
const STATUS_LABEL: Record<ChipStatus, string> = {
  live: 'Live',
  degraded: 'Degraded — polling every 5s',
  disconnected: 'Disconnected — polling every 5s',
  connecting: 'Connecting…',
}

export function StatusChip({ status, lastEventAtMs }: { status: ChipStatus; lastEventAtMs: number | null }) {
  // The "Xs ago" figure must tick on its own — computed at render only, it froze
  // until an unrelated re-render, undermining the freshness claim it exists to make.
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (lastEventAtMs === null) return
    const id = setInterval(tick, 1_000)
    return () => clearInterval(id)
  }, [lastEventAtMs])

  return (
    <span className="status-chip" data-tone={STATUS_TONE[status]}>
      {/* Only the label is a live region — the ticking counter sits OUTSIDE it and is
          aria-hidden, otherwise role=status (implicitly aria-atomic) would re-announce
          the whole chip every second, drowning out the tx-flow announcements. */}
      <span role="status">{STATUS_LABEL[status]}</span>
      {lastEventAtMs !== null ? (
        <span className="muted tabular" aria-hidden="true">
          · last event {Math.max(0, Math.round((Date.now() - lastEventAtMs) / 1000))}s ago
        </span>
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
