import type { Address } from 'viem'
import { WS_PROTOCOL_VERSION, type NetworkKey, type ServerToClient } from '@app/shared'

export type LiveStatus = 'live' | 'degraded' | 'disconnected'

type PositionEventMsg = Extract<ServerToClient, { type: 'position-event' }>

/** Minimal structural WebSocket surface so tests can inject a fake. */
interface WebSocketLike {
  readyState: number
  send(data: string): void
  close(): void
  addEventListener(type: 'open' | 'message' | 'close' | 'error', cb: (ev: { data?: unknown }) => void): void
}

export interface LiveClientOptions {
  WebSocketImpl?: new (url: string) => WebSocketLike
  backoffBaseMs?: number
  backoffCapMs?: number
}

const WS_OPEN = 1

export class LiveClient {
  private readonly url: string
  private readonly WS: new (url: string) => WebSocketLike
  private readonly backoffBaseMs: number
  private readonly backoffCapMs: number
  private socket: WebSocketLike | null = null
  private readonly watches = new Map<string, { network: NetworkKey; address: Address }>()
  private readonly eventCbs = new Set<(e: PositionEventMsg) => void>()
  private readonly statusCbs = new Set<(s: LiveStatus) => void>()
  private consecutiveFailures = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private lastStatus: LiveStatus | null = null

  constructor(url: string, opts: LiveClientOptions = {}) {
    this.url = url
    this.WS = opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as new (url: string) => WebSocketLike)
    this.backoffBaseMs = opts.backoffBaseMs ?? 1_000
    this.backoffCapMs = opts.backoffCapMs ?? 15_000
    this.connect()
  }

  /** Idempotent; automatically re-sent after every reconnect. */
  watch(network: NetworkKey, address: Address): void {
    const key = `${network}:${address.toLowerCase()}`
    if (!this.watches.has(key)) this.watches.set(key, { network, address })
    if (this.socket !== null && this.socket.readyState === WS_OPEN) this.sendWatch(network, address)
  }

  onEvent(cb: (e: PositionEventMsg) => void): () => void {
    this.eventCbs.add(cb)
    return () => this.eventCbs.delete(cb)
  }

  onStatus(cb: (s: LiveStatus) => void): () => void {
    this.statusCbs.add(cb)
    return () => this.statusCbs.delete(cb)
  }

  close(): void {
    this.closed = true
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.socket?.close()
  }

  private emitStatus(s: LiveStatus): void {
    if (s === this.lastStatus) return
    this.lastStatus = s
    for (const cb of [...this.statusCbs]) cb(s)
  }

  private sendWatch(network: NetworkKey, address: Address): void {
    this.socket?.send(JSON.stringify({ v: WS_PROTOCOL_VERSION, type: 'watch', network, address }))
  }

  private connect(): void {
    if (this.closed) return
    const socket = new this.WS(this.url)
    this.socket = socket
    socket.addEventListener('open', () => {
      this.consecutiveFailures = 0
      for (const w of this.watches.values()) this.sendWatch(w.network, w.address)
      this.emitStatus('live')
    })
    socket.addEventListener('message', (ev) => {
      let msg: ServerToClient
      try {
        msg = JSON.parse(String(ev.data)) as ServerToClient
      } catch {
        return
      }
      if (typeof msg !== 'object' || msg === null) return
      if (msg.type === 'position-event') for (const cb of [...this.eventCbs]) cb(msg)
      else if (msg.type === 'status') this.emitStatus(msg.state)
    })
    socket.addEventListener('error', () => {
      /* the close event always follows an error; reconnection is handled there */
    })
    socket.addEventListener('close', () => {
      if (this.closed) return
      this.consecutiveFailures += 1
      this.emitStatus(this.consecutiveFailures >= 2 ? 'disconnected' : 'degraded')
      const delay = Math.min(
        this.backoffCapMs,
        this.backoffBaseMs * 2 ** Math.max(0, this.consecutiveFailures - 1),
      )
      this.reconnectTimer = setTimeout(() => this.connect(), delay)
    })
  }
}
