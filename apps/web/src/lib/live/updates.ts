import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import type { NetworkKey } from '@app/shared'
import { LiveClient, type LiveStatus } from './ws-client'

export interface LiveUpdatesResult {
  status: LiveStatus
  lastEventAtMs: number | null
  /** false while live; 5000 when degraded/disconnected — thread into refetchInterval. */
  pollMs: number | false
}

export function useLiveUpdates(networkKey: NetworkKey, address: Address | undefined): LiveUpdatesResult {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<LiveStatus>('disconnected')
  const [lastEventAtMs, setLastEventAtMs] = useState<number | null>(null)
  const clientRef = useRef<LiveClient | null>(null)
  const addressRef = useRef(address)
  addressRef.current = address

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const client = new LiveClient(`${proto}://${window.location.host}/ws`)
    clientRef.current = client
    const offStatus = client.onStatus(setStatus)
    const offEvent = client.onEvent((e) => {
      setLastEventAtMs(Date.now())
      const current = addressRef.current
      if (current !== undefined && e.address.toLowerCase() === current.toLowerCase()) {
        void queryClient.invalidateQueries({ queryKey: ['userReservesData'] })
        void queryClient.invalidateQueries({ queryKey: ['reservesData'] })
        void queryClient.invalidateQueries({ queryKey: ['tokenState'] })
      }
    })
    return () => {
      offStatus()
      offEvent()
      client.close()
      clientRef.current = null
    }
  }, [queryClient])

  useEffect(() => {
    if (address !== undefined) clientRef.current?.watch(networkKey, address)
  }, [networkKey, address])

  return { status, lastEventAtMs, pollMs: status === 'live' ? false : 5_000 }
}
