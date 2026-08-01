import type pino from 'pino'
import type { WebSocket } from 'ws'
import type { Address, Hex } from 'viem'
import {
  CACHE_INVALIDATION_TOPIC0S,
  extractUserFromLog,
  type MarketConfig,
  type NetworkKey,
  type PositionEventName,
} from '@app/shared'
import type { Upstream } from '../upstream.js'

export type WatcherStatus = 'connecting' | 'live' | 'degraded' | 'stopped'

export interface PositionEvent {
  network: NetworkKey
  address: Address
  event: PositionEventName
  txHash: Hex
  blockNumber: number
}

export interface PoolLogEvent {
  topics: Hex[]
  txHash: Hex
  blockNumber: number
}

export interface WatcherDeps {
  upstream: Upstream
  market: MarketConfig
  log: pino.Logger
  nowMs?: () => number
  backoffBaseMs?: number
  watchdogMs?: number
  // deterministic-test seams (production uses the real timers / Math.random):
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown
  clearTimeoutImpl?: (handle: unknown) => void
  random?: () => number
}

interface RawLog {
  topics: Hex[]
  transactionHash: Hex
  blockNumber: Hex | number
}

const RECONNECT_CAP_MS = 30_000

type ResolvedDeps = WatcherDeps &
  Required<Pick<WatcherDeps, 'nowMs' | 'backoffBaseMs' | 'watchdogMs' | 'setTimeoutImpl' | 'clearTimeoutImpl' | 'random'>>

export class NetworkWatcher {
  readonly #deps: ResolvedDeps
  #socket: WebSocket | null = null
  #status: WatcherStatus = 'stopped'
  #lastBlockSeen: number | null = null
  #lastBlockAtMs: number | null = null
  #started = false
  #stopping = false
  #nextId = 1
  #reconnectAttempt = 0
  #pendingSubs = new Map<number, 'logs' | 'heads'>()
  #logsSubId: string | null = null
  #headsSubId: string | null = null
  #watchdogHandle: unknown = null
  #reconnectHandle: unknown = null
  #repairInFlight = false
  readonly #positionCbs = new Set<(e: PositionEvent) => void>()
  readonly #statusCbs = new Set<(s: WatcherStatus) => void>()
  readonly #poolLogCbs = new Set<(l: PoolLogEvent) => void>()

  constructor(deps: WatcherDeps) {
    this.#deps = {
      ...deps,
      nowMs: deps.nowMs ?? (() => Date.now()),
      backoffBaseMs: deps.backoffBaseMs ?? 1000,
      watchdogMs: deps.watchdogMs ?? 30_000,
      setTimeoutImpl: deps.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimeoutImpl: deps.clearTimeoutImpl ?? ((handle) => clearTimeout(handle as NodeJS.Timeout)),
      random: deps.random ?? Math.random,
    }
  }

  get status(): WatcherStatus {
    return this.#status
  }
  get lastBlockSeen(): number | null {
    return this.#lastBlockSeen
  }
  get lastBlockAtMs(): number | null {
    return this.#lastBlockAtMs
  }

  onPositionEvent(cb: (e: PositionEvent) => void): () => void {
    this.#positionCbs.add(cb)
    return () => this.#positionCbs.delete(cb)
  }
  onStatus(cb: (s: WatcherStatus) => void): () => void {
    this.#statusCbs.add(cb)
    return () => this.#statusCbs.delete(cb)
  }
  onPoolLog(cb: (l: PoolLogEvent) => void): () => void {
    this.#poolLogCbs.add(cb)
    return () => this.#poolLogCbs.delete(cb)
  }

  start(): void {
    if (this.#started) return
    this.#started = true
    this.#connect()
  }

  async stop(): Promise<void> {
    this.#stopping = true
    if (this.#watchdogHandle !== null) {
      this.#deps.clearTimeoutImpl(this.#watchdogHandle)
      this.#watchdogHandle = null
    }
    if (this.#reconnectHandle !== null) {
      this.#deps.clearTimeoutImpl(this.#reconnectHandle)
      this.#reconnectHandle = null
    }
    const socket = this.#socket
    this.#socket = null
    if (socket !== null) {
      socket.removeAllListeners()
      try {
        socket.close()
      } catch {
        // already closed/closing — nothing to do
      }
    }
    this.#setStatus('stopped')
  }

  #setStatus(next: WatcherStatus): void {
    if (this.#status === next) return
    this.#status = next
    for (const cb of this.#statusCbs) cb(next)
  }

  #connect(): void {
    if (this.#stopping) return
    this.#setStatus('connecting')
    const socket = this.#deps.upstream.openSocket(this.#deps.market.networkKey)
    this.#socket = socket
    socket.on('open', () => this.#onOpen())
    socket.on('message', (data: unknown) => this.#onMessage(String(data)))
    socket.on('error', (err: unknown) => {
      // 'close' always follows 'error' on ws sockets; just log (message only — never the error object's config)
      this.#deps.log.warn({ reason: err instanceof Error ? err.message : 'socket error' }, 'watcher socket error')
    })
    socket.on('close', () => this.#onClose())
  }

  #send(msg: unknown): void {
    this.#socket?.send(JSON.stringify(msg))
  }

  #onOpen(): void {
    // NOTE: reconnectAttempt is deliberately NOT reset here. A handshake that succeeds
    // (open) but closes again before any newHeads arrives is not a healthy connection —
    // resetting on open would make backoff hammer a flaky upstream at ~base interval
    // forever. The counter only resets once the socket proves itself live (#onHead).
    const logsId = this.#nextId++
    const headsId = this.#nextId++
    this.#pendingSubs.set(logsId, 'logs')
    this.#pendingSubs.set(headsId, 'heads')
    this.#send({
      jsonrpc: '2.0',
      id: logsId,
      method: 'eth_subscribe',
      params: ['logs', { address: this.#deps.market.pool, topics: [[...CACHE_INVALIDATION_TOPIC0S]] }],
    })
    this.#send({ jsonrpc: '2.0', id: headsId, method: 'eth_subscribe', params: ['newHeads'] })
    if (this.#lastBlockSeen !== null) {
      void this.#repairGap(this.#lastBlockSeen + 1)
    }
    this.#armWatchdog()
  }

  #onMessage(raw: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    if (typeof msg.id === 'number' && this.#pendingSubs.has(msg.id)) {
      const kind = this.#pendingSubs.get(msg.id)
      this.#pendingSubs.delete(msg.id)
      if (typeof msg.result === 'string') {
        if (kind === 'logs') this.#logsSubId = msg.result
        else this.#headsSubId = msg.result
      } else {
        this.#deps.log.warn({ kind, error: msg.error ?? null }, 'eth_subscribe rejected')
      }
      return
    }
    if (msg.method !== 'eth_subscription') return
    const params = msg.params as { subscription?: string; result?: unknown } | undefined
    if (params === undefined) return
    if (params.subscription === this.#headsSubId) {
      const head = params.result as { number?: string } | undefined
      if (typeof head?.number === 'string') this.#onHead(Number.parseInt(head.number, 16))
      return
    }
    if (params.subscription === this.#logsSubId) {
      this.#handleLog(params.result as RawLog)
    }
  }

  #onHead(blockNumber: number): void {
    this.#reconnectAttempt = 0 // proven live — future disconnects start backoff fresh from base
    this.#lastBlockSeen = blockNumber
    this.#lastBlockAtMs = this.#deps.nowMs()
    this.#setStatus('live')
    this.#armWatchdog()
  }

  #handleLog(log: RawLog): void {
    if (!Array.isArray(log?.topics)) return
    const blockNumber =
      typeof log.blockNumber === 'string' ? Number.parseInt(log.blockNumber, 16) : Number(log.blockNumber ?? 0)
    for (const cb of this.#poolLogCbs) cb({ topics: log.topics, txHash: log.transactionHash, blockNumber })
    const match = extractUserFromLog(log.topics)
    if (match === null) return // e.g. ReserveDataUpdated: cache-invalidation only
    const event: PositionEvent = {
      network: this.#deps.market.networkKey,
      address: match.user,
      event: match.event,
      txHash: log.transactionHash,
      blockNumber,
    }
    for (const cb of this.#positionCbs) cb(event)
  }

  async #repairGap(fromBlock: number): Promise<void> {
    // A prior repair from an earlier reconnect may still be in flight (e.g. rapid
    // disconnect/reconnect churn while eth_getLogs is slow). Starting a second, overlapping
    // request for the same/overlapping range would re-emit the same missed PositionEvents.
    // Skip; the next reconnect after the in-flight one settles will cover any remaining gap.
    if (this.#repairInFlight) {
      this.#deps.log.warn({ fromBlock }, 'gap repair already in flight — skipping duplicate request')
      return
    }
    this.#repairInFlight = true
    try {
      const res = await this.#deps.upstream.rpc(this.#deps.market.networkKey, {
        jsonrpc: '2.0',
        id: this.#nextId++,
        method: 'eth_getLogs',
        params: [
          {
            address: this.#deps.market.pool,
            topics: [[...CACHE_INVALIDATION_TOPIC0S]],
            fromBlock: `0x${fromBlock.toString(16)}`,
            toBlock: 'latest',
          },
        ],
      })
      const body = res.body as { result?: unknown }
      if (Array.isArray(body.result)) {
        this.#deps.log.info({ fromBlock, count: body.result.length }, 'gap repair fetched missed logs')
        for (const log of body.result) this.#handleLog(log as RawLog)
      }
    } catch (err) {
      // UpstreamError messages are already sanitized; nothing else is rethrown from upstream.ts
      this.#deps.log.warn({ reason: err instanceof Error ? err.message : 'unknown' }, 'gap repair failed')
    } finally {
      this.#repairInFlight = false
    }
  }

  #armWatchdog(): void {
    if (this.#watchdogHandle !== null) this.#deps.clearTimeoutImpl(this.#watchdogHandle)
    this.#watchdogHandle = this.#deps.setTimeoutImpl(() => {
      this.#watchdogHandle = null
      this.#deps.log.warn({ lastBlockSeen: this.#lastBlockSeen }, 'watchdog: no newHeads — forcing reconnect')
      this.#socket?.terminate()
    }, this.#deps.watchdogMs)
  }

  #onClose(): void {
    if (this.#stopping) return
    if (this.#watchdogHandle !== null) {
      this.#deps.clearTimeoutImpl(this.#watchdogHandle)
      this.#watchdogHandle = null
    }
    this.#socket?.removeAllListeners()
    this.#socket = null
    this.#logsSubId = null
    this.#headsSubId = null
    this.#pendingSubs.clear()
    this.#setStatus('degraded')
    const raw = Math.min(this.#deps.backoffBaseMs * 2 ** this.#reconnectAttempt, RECONNECT_CAP_MS)
    const delay = Math.round(raw * (0.8 + 0.4 * this.#deps.random())) // ±20% jitter
    this.#reconnectAttempt += 1
    this.#deps.log.info({ delayMs: delay, attempt: this.#reconnectAttempt }, 'watcher reconnecting')
    this.#reconnectHandle = this.#deps.setTimeoutImpl(() => {
      this.#reconnectHandle = null
      this.#connect()
    }, delay)
  }
}
