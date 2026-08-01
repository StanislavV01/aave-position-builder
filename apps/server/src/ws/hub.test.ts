import { EventEmitter } from 'node:events'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import type { WebSocket } from 'ws'
import { Hub } from './hub.js'
import type { NetworkWatcher, PositionEvent, WatcherStatus } from './watcher.js'

const ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const ADDR_CHECKSUMMED = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const OTHER_ADDR = '0x2222222222222222222222222222222222222222'
const TX_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

class FakeWatcher {
  started = false
  stopped = false
  status: WatcherStatus = 'connecting'
  lastBlockSeen: number | null = null
  lastBlockAtMs: number | null = null
  #positionCbs = new Set<(e: PositionEvent) => void>()
  #statusCbs = new Set<(s: WatcherStatus) => void>()
  start(): void {
    this.started = true
  }
  async stop(): Promise<void> {
    this.stopped = true
  }
  onPositionEvent(cb: (e: PositionEvent) => void): () => void {
    this.#positionCbs.add(cb)
    return () => this.#positionCbs.delete(cb)
  }
  onStatus(cb: (s: WatcherStatus) => void): () => void {
    this.#statusCbs.add(cb)
    return () => this.#statusCbs.delete(cb)
  }
  onPoolLog(): () => void {
    return () => {}
  }
  emitPosition(e: PositionEvent): void {
    for (const cb of this.#positionCbs) cb(e)
  }
  emitStatus(s: WatcherStatus): void {
    this.status = s
    for (const cb of this.#statusCbs) cb(s)
  }
}

class FakeClientSocket extends EventEmitter {
  readyState = 1 // WebSocket.OPEN
  sent: Record<string, unknown>[] = []
  closeCode: number | null = null
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }
  close(code?: number): void {
    this.closeCode = code ?? 1000
    this.readyState = 3 // CLOSED
    this.emit('close')
  }
}

function makeHub(heartbeatSec = 12) {
  const made: { network: string; watcher: FakeWatcher }[] = []
  const hub = new Hub({
    heartbeatSec,
    log: pino({ level: 'silent' }),
    makeWatcher: (market) => {
      const watcher = new FakeWatcher()
      made.push({ network: market.networkKey, watcher })
      return watcher as unknown as NetworkWatcher
    },
  })
  return { hub, made }
}

function connect(hub: Hub): FakeClientSocket {
  const socket = new FakeClientSocket()
  hub.handleSocket(socket as unknown as WebSocket)
  return socket
}

function watch(socket: FakeClientSocket, network: string, address: string): void {
  socket.emit('message', Buffer.from(JSON.stringify({ v: 1, type: 'watch', network, address })))
}

describe('Hub', () => {
  it('sends hello with heartbeatSec on connect', () => {
    const { hub } = makeHub(12)
    const socket = connect(hub)
    expect(socket.sent).toEqual([{ v: 1, type: 'hello', heartbeatSec: 12 }])
  })

  it('lazily creates exactly one watcher per network', () => {
    const { hub, made } = makeHub()
    const a = connect(hub)
    const b = connect(hub)
    expect(made).toHaveLength(0) // nothing until the first watch
    watch(a, 'base-sepolia', ADDR)
    watch(b, 'base-sepolia', OTHER_ADDR)
    expect(made).toHaveLength(1)
    expect(made[0].network).toBe('base-sepolia')
    expect(made[0].watcher.started).toBe(true)
    watch(a, 'base', ADDR)
    expect(made).toHaveLength(2)
    expect(made[1].network).toBe('base')
  })

  it('fans out position events only to sockets watching that (network,address), case-insensitively', () => {
    const { hub, made } = makeHub()
    const watching = connect(hub)
    const other = connect(hub)
    watch(watching, 'base-sepolia', ADDR.toLowerCase())
    watch(other, 'base-sepolia', OTHER_ADDR)
    made[0].watcher.emitPosition({
      network: 'base-sepolia',
      address: ADDR_CHECKSUMMED as PositionEvent['address'],
      event: 'Supply',
      txHash: TX_HASH as PositionEvent['txHash'],
      blockNumber: 101,
    })
    const positionMsgs = watching.sent.filter((m) => m.type === 'position-event')
    expect(positionMsgs).toEqual([
      {
        v: 1,
        type: 'position-event',
        network: 'base-sepolia',
        address: ADDR_CHECKSUMMED,
        event: 'Supply',
        txHash: TX_HASH,
        blockNumber: 101,
      },
    ])
    expect(other.sent.filter((m) => m.type === 'position-event')).toHaveLength(0)
  })

  it('broadcasts watcher status changes to that network\'s sockets only', () => {
    const { hub, made } = makeHub()
    const sepoliaClient = connect(hub)
    const baseClient = connect(hub)
    watch(sepoliaClient, 'base-sepolia', ADDR)
    watch(baseClient, 'base', ADDR)
    // Each watch() above created a fresh watcher and immediately sent that registering
    // client its current ('connecting' -> 'degraded') status — see the registration tests
    // below. Only the changes that follow are under test here.
    made[0].watcher.emitStatus('live')
    expect(sepoliaClient.sent.filter((m) => m.type === 'status')).toEqual([
      { v: 1, type: 'status', network: 'base-sepolia', state: 'degraded' },
      { v: 1, type: 'status', network: 'base-sepolia', state: 'live' },
    ])
    expect(baseClient.sent.filter((m) => m.type === 'status')).toEqual([
      { v: 1, type: 'status', network: 'base', state: 'degraded' },
    ])
    made[0].watcher.emitStatus('connecting') // non-live maps to degraded
    expect(sepoliaClient.sent.filter((m) => m.type === 'status').at(-1)).toEqual({
      v: 1,
      type: 'status',
      network: 'base-sepolia',
      state: 'degraded',
    })
  })

  it('sends the current watcher status to a client the moment it registers a watch (fresh watcher: connecting -> degraded)', () => {
    const { hub } = makeHub()
    const socket = connect(hub)
    watch(socket, 'base-sepolia', ADDR)
    expect(socket.sent.filter((m) => m.type === 'status')).toEqual([
      { v: 1, type: 'status', network: 'base-sepolia', state: 'degraded' },
    ])
  })

  it('sends the current watcher status to a client that registers after the watcher is already live', () => {
    const { hub, made } = makeHub()
    const first = connect(hub)
    watch(first, 'base-sepolia', ADDR)
    made[0].watcher.emitStatus('live')

    const second = connect(hub)
    watch(second, 'base-sepolia', OTHER_ADDR)
    expect(second.sent.filter((m) => m.type === 'status')).toEqual([
      { v: 1, type: 'status', network: 'base-sepolia', state: 'live' },
    ])
  })

  it('sends the current watcher status to a client that registers while an existing watcher is degraded', () => {
    const { hub, made } = makeHub()
    const first = connect(hub)
    watch(first, 'base-sepolia', ADDR)
    made[0].watcher.emitStatus('live')
    made[0].watcher.emitStatus('degraded')

    const second = connect(hub)
    watch(second, 'base-sepolia', OTHER_ADDR)
    expect(second.sent.filter((m) => m.type === 'status')).toEqual([
      { v: 1, type: 'status', network: 'base-sepolia', state: 'degraded' },
    ])
  })

  it('stops the watcher when the last socket watching that network closes', () => {
    const { hub, made } = makeHub()
    const a = connect(hub)
    const b = connect(hub)
    watch(a, 'base-sepolia', ADDR)
    watch(b, 'base-sepolia', OTHER_ADDR)
    a.close()
    expect(made[0].watcher.stopped).toBe(false)
    b.close()
    expect(made[0].watcher.stopped).toBe(true)
    expect(hub.networkStatus('base-sepolia')).toBeNull()
  })

  it('exposes watcher state via networkStatus while watched', () => {
    const { hub, made } = makeHub()
    const socket = connect(hub)
    watch(socket, 'base-sepolia', ADDR)
    made[0].watcher.status = 'live'
    made[0].watcher.lastBlockSeen = 123
    made[0].watcher.lastBlockAtMs = 456
    expect(hub.networkStatus('base-sepolia')).toEqual({ ws: 'live', lastBlockSeen: 123, lastBlockAtMs: 456 })
    expect(hub.networkStatus('base')).toBeNull()
  })

  it('ignores invalid messages without crashing and without creating watchers', () => {
    const { hub, made } = makeHub()
    const socket = connect(hub)
    socket.emit('message', Buffer.from('this is { not json'))
    socket.emit('message', Buffer.from(JSON.stringify({ v: 1, type: 'nope' })))
    socket.emit('message', Buffer.from(JSON.stringify({ v: 99, type: 'watch', network: 'base', address: ADDR })))
    socket.emit('message', Buffer.from(JSON.stringify({ v: 1, type: 'watch', network: 'dogechain', address: ADDR })))
    expect(made).toHaveLength(0)
    expect(socket.sent).toHaveLength(1) // hello only — no error frames in P0
  })

  it('close() sends 1001 to every client and stops all watchers', async () => {
    const { hub, made } = makeHub()
    const a = connect(hub)
    const b = connect(hub)
    watch(a, 'base-sepolia', ADDR)
    watch(b, 'base', ADDR)
    await hub.close()
    expect(a.closeCode).toBe(1001)
    expect(b.closeCode).toBe(1001)
    expect(made.every((m) => m.watcher.stopped)).toBe(true)
  })

  it('does not produce an unhandled rejection when watcher.stop() rejects, and re-watch creates a fresh watcher', async () => {
    const made: FakeWatcher[] = []
    let callCount = 0
    const hub = new Hub({
      heartbeatSec: 12,
      log: pino({ level: 'silent' }),
      makeWatcher: () => {
        callCount += 1
        const watcher = new FakeWatcher()
        if (callCount === 1) {
          watcher.stop = async () => {
            watcher.stopped = true
            throw new Error('stop failed')
          }
        }
        made.push(watcher)
        return watcher as unknown as NetworkWatcher
      },
    })
    const a = connect(hub)
    watch(a, 'base-sepolia', ADDR)
    a.close()
    // Let the rejected stop() promise's .catch() handler run before asserting.
    await new Promise((resolve) => setImmediate(resolve))
    expect(made[0].stopped).toBe(true)
    expect(hub.networkStatus('base-sepolia')).toBeNull()

    const b = connect(hub)
    watch(b, 'base-sepolia', ADDR)
    expect(made).toHaveLength(2)
    expect(made[1]).not.toBe(made[0])
    expect(made[1].started).toBe(true)
  })

  it('close() still resolves and stops every watcher even if one watcher.stop() rejects', async () => {
    const made: { network: string; watcher: FakeWatcher }[] = []
    const hub = new Hub({
      heartbeatSec: 12,
      log: pino({ level: 'silent' }),
      makeWatcher: (market) => {
        const watcher = new FakeWatcher()
        if (market.networkKey === 'base-sepolia') {
          watcher.stop = async () => {
            watcher.stopped = true
            throw new Error('stop failed')
          }
        }
        made.push({ network: market.networkKey, watcher })
        return watcher as unknown as NetworkWatcher
      },
    })
    const a = connect(hub)
    const b = connect(hub)
    watch(a, 'base-sepolia', ADDR)
    watch(b, 'base', ADDR)
    await expect(hub.close()).resolves.toBeUndefined()
    expect(made.every((m) => m.watcher.stopped)).toBe(true)
  })
})
