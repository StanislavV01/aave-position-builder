import type pino from 'pino'
import type { WebSocket } from 'ws'
import {
  marketByNetworkKey,
  parseClientMessage,
  WS_PROTOCOL_VERSION,
  type MarketConfig,
  type NetworkKey,
  type ServerToClient,
} from '@app/shared'
import type { NetworkWatcher, PositionEvent, WatcherStatus } from './watcher.js'

export interface HubDeps {
  makeWatcher: (market: MarketConfig) => NetworkWatcher
  log: pino.Logger
  heartbeatSec?: number
}

interface ClientConn {
  socket: WebSocket
  watches: Set<string> // `${network}:${lowercase address}`
  networks: Set<NetworkKey>
}

interface WatcherEntry {
  watcher: NetworkWatcher
  unsubs: (() => void)[]
}

const WS_OPEN = 1
const DEFAULT_HEARTBEAT_SEC = 30

export class Hub {
  readonly #deps: HubDeps
  readonly #heartbeatSec: number
  readonly #clients = new Set<ClientConn>()
  readonly #watchers = new Map<NetworkKey, WatcherEntry>()

  constructor(deps: HubDeps) {
    this.#deps = deps
    this.#heartbeatSec = deps.heartbeatSec ?? DEFAULT_HEARTBEAT_SEC
  }

  handleSocket(socket: WebSocket): void {
    const conn: ClientConn = { socket, watches: new Set(), networks: new Set() }
    this.#clients.add(conn)
    this.#send(socket, { v: WS_PROTOCOL_VERSION, type: 'hello', heartbeatSec: this.#heartbeatSec })
    socket.on('message', (raw: unknown) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(raw))
      } catch {
        return // invalid frame: ignored by design (P0 decision — no error frame)
      }
      const msg = parseClientMessage(parsed)
      if (msg === null) return
      this.#registerWatch(conn, msg.network, msg.address)
    })
    socket.on('close', () => {
      this.#clients.delete(conn)
      for (const network of conn.networks) this.#stopWatcherIfUnwatched(network)
    })
    socket.on('error', () => {
      // 'close' follows; cleanup happens there
    })
  }

  networkStatus(
    key: NetworkKey,
  ): { ws: WatcherStatus; lastBlockSeen: number | null; lastBlockAtMs: number | null } | null {
    const entry = this.#watchers.get(key)
    if (entry === undefined) return null
    return {
      ws: entry.watcher.status,
      lastBlockSeen: entry.watcher.lastBlockSeen,
      lastBlockAtMs: entry.watcher.lastBlockAtMs,
    }
  }

  async close(): Promise<void> {
    const entries = [...this.#watchers.entries()]
    this.#watchers.clear()
    for (const conn of [...this.#clients]) {
      try {
        conn.socket.close(1001, 'server shutting down')
      } catch {
        // socket already gone
      }
    }
    this.#clients.clear()
    for (const [network, entry] of entries) {
      for (const unsub of entry.unsubs) unsub()
      try {
        await entry.watcher.stop()
      } catch (err) {
        // Never let one watcher's failed stop() abort teardown of the rest —
        // close() must always attempt every watcher and always resolve.
        this.#deps.log.warn({ err, network }, 'watcher stop failed during close')
      }
    }
  }

  #registerWatch(conn: ClientConn, network: NetworkKey, address: string): void {
    conn.watches.add(`${network}:${address.toLowerCase()}`)
    conn.networks.add(network)
    this.#ensureWatcher(network)
  }

  #ensureWatcher(network: NetworkKey): void {
    if (this.#watchers.has(network)) return
    const market = marketByNetworkKey(network)
    const watcher = this.#deps.makeWatcher(market)
    const unsubs = [
      watcher.onPositionEvent((e) => this.#fanoutPositionEvent(e)),
      watcher.onStatus((s) => this.#broadcastStatus(network, s)),
    ]
    this.#watchers.set(network, { watcher, unsubs })
    this.#deps.log.info({ network }, 'starting network watcher')
    watcher.start()
  }

  #stopWatcherIfUnwatched(network: NetworkKey): void {
    for (const client of this.#clients) {
      if (client.networks.has(network)) return
    }
    const entry = this.#watchers.get(network)
    if (entry === undefined) return
    this.#watchers.delete(network)
    for (const unsub of entry.unsubs) unsub()
    this.#deps.log.info({ network }, 'stopping network watcher (no clients left)')
    entry.watcher.stop().catch((err: unknown) => {
      this.#deps.log.warn({ err, network }, 'watcher stop failed')
    })
  }

  #fanoutPositionEvent(e: PositionEvent): void {
    const key = `${e.network}:${e.address.toLowerCase()}`
    const msg: ServerToClient = {
      v: WS_PROTOCOL_VERSION,
      type: 'position-event',
      network: e.network,
      address: e.address,
      event: e.event,
      txHash: e.txHash,
      blockNumber: e.blockNumber,
    }
    for (const client of this.#clients) {
      if (client.watches.has(key)) this.#send(client.socket, msg)
    }
  }

  #broadcastStatus(network: NetworkKey, status: WatcherStatus): void {
    if (status === 'stopped') return
    const state = status === 'live' ? ('live' as const) : ('degraded' as const)
    const msg: ServerToClient = { v: WS_PROTOCOL_VERSION, type: 'status', network, state }
    for (const client of this.#clients) {
      if (client.networks.has(network)) this.#send(client.socket, msg)
    }
  }

  #send(socket: WebSocket, msg: ServerToClient): void {
    if (socket.readyState !== WS_OPEN) return
    try {
      socket.send(JSON.stringify(msg))
    } catch {
      // client vanished mid-send; its close event will clean up
    }
  }
}
