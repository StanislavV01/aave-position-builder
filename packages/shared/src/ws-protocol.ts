// Versioned WS envelope shared by server hub and web client. The server treats
// every inbound frame as hostile: parseClientMessage returns null on ANYTHING
// that is not a well-formed v1 watch message (never throws).
import { z } from 'zod'
import type { Address, Hex } from 'viem'
import type { NetworkKey } from './networks'
import type { PositionEventName } from './topic-map'

export const WS_PROTOCOL_VERSION = 1 as const

export type ClientToServer = { v: 1; type: 'watch'; network: NetworkKey; address: Address }

export type ServerToClient =
  | { v: 1; type: 'hello'; heartbeatSec: number }
  | {
      v: 1
      type: 'position-event'
      network: NetworkKey
      address: Address
      event: PositionEventName
      txHash: Hex
      blockNumber: number
    }
  | { v: 1; type: 'status'; network: NetworkKey; state: 'live' | 'degraded' }

const watchSchema = z.object({
  v: z.literal(WS_PROTOCOL_VERSION),
  type: z.literal('watch'),
  network: z.enum(['base', 'base-sepolia']),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
})

export function parseClientMessage(raw: unknown): ClientToServer | null {
  let candidate: unknown = raw
  if (raw instanceof Uint8Array) {
    try {
      candidate = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
    } catch {
      return null
    }
  } else if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw)
    } catch {
      return null
    }
  }
  const result = watchSchema.safeParse(candidate)
  if (!result.success) return null
  return { v: 1, type: 'watch', network: result.data.network, address: result.data.address as Address }
}
