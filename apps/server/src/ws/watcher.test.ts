import { EventEmitter } from 'node:events'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { getAddress, padHex } from 'viem'
import type { Hex } from 'viem'
import {
  CACHE_INVALIDATION_TOPIC0S,
  marketByNetworkKey,
  POSITION_EVENT_TOPIC0S,
  POSITION_EVENTS,
} from '@app/shared'
import type { Upstream } from '../upstream.js'
import { NetworkWatcher, type PositionEvent, type PoolLogEvent, type WatcherStatus } from './watcher.js'

const MARKET = marketByNetworkKey('base-sepolia')
const USER = '0x1111111111111111111111111111111111111111'
const RESERVE = '0x4200000000000000000000000000000000000006'
const TX_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SUPPLY = POSITION_EVENTS.find((e) => e.name === 'Supply')!
// ReserveDataUpdated is the one cache-invalidation topic0 that is NOT a position event:
const RESERVE_DATA_UPDATED_TOPIC0 = CACHE_INVALIDATION_TOPIC0S.find(
  (t) => !POSITION_EVENT_TOPIC0S.includes(t),
)!

/** Pool Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode) */
function supplyLog(blockNumber: number): Record<string, unknown> {
  return {
    address: MARKET.pool,
    topics: [
      SUPPLY.topic0,
      padHex(RESERVE as Hex, { size: 32 }),
      padHex(USER as Hex, { size: 32 }), // topic2 = onBehalfOf = position owner
      padHex('0x00', { size: 32 }), // topic3 = referralCode
    ],
    data: '0x',
    blockNumber: `0x${blockNumber.toString(16)}`,
    transactionHash: TX_HASH,
  }
}

class FakeSocket extends EventEmitter {
  sent: Record<string, unknown>[] = []
  closed = false
  terminated = false
  opened = false
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }
  close(): void {
    this.closed = true
    this.#closeOrAbort()
  }
  terminate(): void {
    this.terminated = true
    this.#closeOrAbort()
  }
  // Mirrors real `ws` semantics: a socket that never finished connecting emits 'error'
  // ("WebSocket was closed before the connection was established") THEN 'close' when
  // closed/terminated — asynchronously (ws does this via process.nextTick), not inline.
  // An already-open socket just closes normally with no error.
  #closeOrAbort(): void {
    if (this.opened) {
      this.emit('close')
      return
    }
    process.nextTick(() => {
      this.emit('error', new Error('WebSocket was closed before the connection was established'))
      this.emit('close')
    })
  }
  // test-side helpers
  open(): void {
    this.opened = true
    this.emit('open')
  }
  receive(msg: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(msg)))
  }
}

class FakeUpstream {
  sockets: FakeSocket[] = []
  getLogsCalls: { network: string; params: unknown[] }[] = []
  getLogsResult: unknown[] = []
  /** When true, eth_getLogs calls do not resolve until resolvePendingGetLogs() is called —
   *  lets tests exercise overlapping/in-flight gap-repair races deterministically. */
  deferGetLogs = false
  #pendingGetLogs: {
    id: unknown
    resolve: (v: { status: number; body: unknown }) => void
    reject: (err: unknown) => void
  }[] = []
  async rpc(network: string, body: unknown): Promise<{ status: number; body: unknown }> {
    const req = body as { id?: unknown; method?: string; params?: unknown[] }
    if (req.method === 'eth_getLogs') {
      this.getLogsCalls.push({ network, params: req.params ?? [] })
      if (this.deferGetLogs) {
        return new Promise((resolve, reject) => {
          this.#pendingGetLogs.push({ id: req.id ?? null, resolve, reject })
        })
      }
      return { status: 200, body: { jsonrpc: '2.0', id: req.id ?? null, result: this.getLogsResult } }
    }
    return { status: 200, body: { jsonrpc: '2.0', id: req.id ?? null, result: null } }
  }
  /** Resolves the oldest pending deferred eth_getLogs call (FIFO) with the given result. */
  resolvePendingGetLogs(result: unknown[]): void {
    const pending = this.#pendingGetLogs.shift()
    if (pending === undefined) return
    pending.resolve({ status: 200, body: { jsonrpc: '2.0', id: pending.id, result } })
  }
  /** Rejects the oldest pending deferred eth_getLogs call (FIFO) — simulates a rate-limit,
   *  range-too-large, or timeout error from the upstream during connection churn. */
  rejectPendingGetLogs(err: unknown): void {
    const pending = this.#pendingGetLogs.shift()
    if (pending === undefined) return
    pending.reject(err)
  }
  get pendingGetLogsCount(): number {
    return this.#pendingGetLogs.length
  }
  openSocket(): FakeSocket {
    const socket = new FakeSocket()
    this.sockets.push(socket)
    return socket
  }
}

class FakeClock {
  now = 0
  allDelays: number[] = []
  timers: { id: number; at: number; fn: () => void }[] = []
  #nextId = 1
  nowMs = (): number => this.now
  setTimeoutImpl = (fn: () => void, ms: number): unknown => {
    const id = this.#nextId++
    this.allDelays.push(ms)
    this.timers.push({ id, at: this.now + ms, fn })
    return id
  }
  clearTimeoutImpl = (handle: unknown): void => {
    this.timers = this.timers.filter((t) => t.id !== handle)
  }
  advance(ms: number): void {
    this.now += ms
    const due = this.timers.filter((t) => t.at <= this.now).sort((a, b) => a.at - b.at)
    this.timers = this.timers.filter((t) => t.at > this.now)
    for (const timer of due) timer.fn()
  }
}

function makeHarness(overrides: { watchdogMs?: number } = {}) {
  const upstream = new FakeUpstream()
  const clock = new FakeClock()
  const events: PositionEvent[] = []
  const statuses: WatcherStatus[] = []
  const poolLogs: PoolLogEvent[] = []
  const watcher = new NetworkWatcher({
    upstream: upstream as unknown as Upstream,
    market: MARKET,
    log: pino({ level: 'silent' }),
    nowMs: clock.nowMs,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    random: () => 0.5, // jitter factor becomes exactly 1.0
    backoffBaseMs: 1000,
    watchdogMs: overrides.watchdogMs ?? 30_000,
  })
  watcher.onPositionEvent((e) => events.push(e))
  watcher.onStatus((s) => statuses.push(s))
  watcher.onPoolLog((l) => poolLogs.push(l))
  return { upstream, clock, watcher, events, statuses, poolLogs }
}

function confirmSubs(socket: FakeSocket): void {
  const [logsReq, headsReq] = socket.sent
  socket.receive({ jsonrpc: '2.0', id: logsReq.id, result: '0xlogs' })
  socket.receive({ jsonrpc: '2.0', id: headsReq.id, result: '0xheads' })
}

function sendHead(socket: FakeSocket, blockNumber: number): void {
  socket.receive({
    jsonrpc: '2.0',
    method: 'eth_subscription',
    params: { subscription: '0xheads', result: { number: `0x${blockNumber.toString(16)}` } },
  })
}

function sendLog(socket: FakeSocket, log: unknown): void {
  socket.receive({
    jsonrpc: '2.0',
    method: 'eth_subscription',
    params: { subscription: '0xlogs', result: log },
  })
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('NetworkWatcher', () => {
  it('start opens one socket and sends logs + newHeads subscriptions on open', () => {
    const h = makeHarness()
    h.watcher.start()
    expect(h.upstream.sockets).toHaveLength(1)
    expect(h.watcher.status).toBe('connecting')
    const socket = h.upstream.sockets[0]
    socket.open()
    expect(socket.sent).toHaveLength(2)
    expect(socket.sent[0].method).toBe('eth_subscribe')
    expect(socket.sent[0].params).toEqual([
      'logs',
      { address: MARKET.pool, topics: [[...CACHE_INVALIDATION_TOPIC0S]] },
    ])
    expect(socket.sent[1].method).toBe('eth_subscribe')
    expect(socket.sent[1].params).toEqual(['newHeads'])
  })

  it('newHeads updates lastBlockSeen/lastBlockAtMs and flips status to live', () => {
    const h = makeHarness()
    h.watcher.start()
    const socket = h.upstream.sockets[0]
    socket.open()
    confirmSubs(socket)
    h.clock.now = 5000
    sendHead(socket, 100)
    expect(h.watcher.lastBlockSeen).toBe(100)
    expect(h.watcher.lastBlockAtMs).toBe(5000)
    expect(h.watcher.status).toBe('live')
    expect(h.statuses).toEqual(['connecting', 'live'])
  })

  it('a Supply log for user X emits PositionEvent{event: Supply, address: X} and an onPoolLog', () => {
    const h = makeHarness()
    h.watcher.start()
    const socket = h.upstream.sockets[0]
    socket.open()
    confirmSubs(socket)
    sendLog(socket, supplyLog(101))
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({
      network: 'base-sepolia',
      event: 'Supply',
      txHash: TX_HASH,
      blockNumber: 101,
    })
    expect(h.events[0].address).toBe(getAddress(USER))
    expect(h.poolLogs).toHaveLength(1)
  })

  it('ReserveDataUpdated emits onPoolLog but NOT a PositionEvent', () => {
    const h = makeHarness()
    h.watcher.start()
    const socket = h.upstream.sockets[0]
    socket.open()
    confirmSubs(socket)
    sendLog(socket, {
      address: MARKET.pool,
      topics: [RESERVE_DATA_UPDATED_TOPIC0, padHex(RESERVE as Hex, { size: 32 })],
      data: '0x',
      blockNumber: '0x66',
      transactionHash: TX_HASH,
    })
    expect(h.poolLogs).toHaveLength(1)
    expect(h.poolLogs[0].blockNumber).toBe(0x66)
    expect(h.events).toHaveLength(0)
  })

  it('backoff delay grows across consecutive failed connects (1s, 2s, cap 30s)', () => {
    const h = makeHarness()
    h.watcher.start()
    h.upstream.sockets[0].emit('close')
    expect(h.watcher.status).toBe('degraded')
    h.clock.advance(1000)
    expect(h.upstream.sockets).toHaveLength(2)
    h.upstream.sockets[1].emit('close')
    h.clock.advance(1999)
    expect(h.upstream.sockets).toHaveLength(2) // second retry not due yet
    h.clock.advance(1)
    expect(h.upstream.sockets).toHaveLength(3)
    expect(h.clock.allDelays).toEqual([1000, 2000]) // random()=0.5 → jitter factor exactly 1.0
  })

  it('reconnect resubscribes and gap-repairs from lastBlockSeen+1, emitting missed events', async () => {
    const h = makeHarness()
    h.watcher.start()
    const s1 = h.upstream.sockets[0]
    s1.open()
    confirmSubs(s1)
    sendHead(s1, 100)
    h.upstream.getLogsResult = [supplyLog(101)]
    s1.emit('close')
    expect(h.watcher.status).toBe('degraded')
    h.clock.advance(1000)
    const s2 = h.upstream.sockets[1]
    s2.open()
    expect(s2.sent.filter((m) => m.method === 'eth_subscribe')).toHaveLength(2)
    await flush()
    expect(h.upstream.getLogsCalls).toHaveLength(1)
    expect(h.upstream.getLogsCalls[0].network).toBe('base-sepolia')
    expect(h.upstream.getLogsCalls[0].params[0]).toEqual({
      address: MARKET.pool,
      topics: [[...CACHE_INVALIDATION_TOPIC0S]],
      fromBlock: '0x65', // 100 + 1
      toBlock: 'latest',
    })
    expect(h.events.map((e) => e.event)).toEqual(['Supply'])
    expect(h.events[0].blockNumber).toBe(101)
  })

  it('watchdog terminates the socket after watchdogMs without heads, then reconnects', () => {
    const h = makeHarness({ watchdogMs: 30_000 })
    h.watcher.start()
    const s1 = h.upstream.sockets[0]
    s1.open()
    confirmSubs(s1)
    sendHead(s1, 100)
    h.clock.advance(29_999)
    expect(s1.terminated).toBe(false)
    h.clock.advance(1)
    expect(s1.terminated).toBe(true)
    expect(h.watcher.status).toBe('degraded')
    h.clock.advance(1000)
    expect(h.upstream.sockets).toHaveLength(2)
  })

  it('stop() closes the socket, reports stopped, and never reconnects', async () => {
    const h = makeHarness()
    h.watcher.start()
    const s1 = h.upstream.sockets[0]
    s1.open()
    confirmSubs(s1)
    await h.watcher.stop()
    expect(s1.closed).toBe(true)
    expect(h.watcher.status).toBe('stopped')
    h.clock.advance(120_000)
    expect(h.upstream.sockets).toHaveLength(1)
  })

  it('a socket error followed by close schedules exactly one reconnect, not two', () => {
    const h = makeHarness()
    h.watcher.start()
    const s1 = h.upstream.sockets[0]
    s1.emit('error', new Error('ECONNRESET'))
    s1.emit('close')
    expect(h.watcher.status).toBe('degraded')
    h.clock.advance(1000)
    expect(h.upstream.sockets).toHaveLength(2) // exactly one new socket, not a storm
    h.clock.advance(1000)
    expect(h.upstream.sockets).toHaveLength(2) // no further reconnect scheduled by the error itself
  })

  it('stop() during the backoff wait cancels the pending reconnect', async () => {
    const h = makeHarness()
    h.watcher.start()
    const s1 = h.upstream.sockets[0]
    s1.emit('close') // schedules a reconnect after the backoff delay
    expect(h.watcher.status).toBe('degraded')
    await h.watcher.stop()
    expect(h.watcher.status).toBe('stopped')
    h.clock.advance(120_000)
    expect(h.upstream.sockets).toHaveLength(1) // the scheduled reconnect never fired
  })

  it('backoff only resets once live (first head), not merely on socket open', () => {
    const h = makeHarness()
    h.watcher.start()
    const s1 = h.upstream.sockets[0]
    s1.open()
    confirmSubs(s1)
    s1.emit('close') // no head ever arrived on s1 — degraded from attempt 0
    h.clock.advance(1000) // base * 2^0
    expect(h.upstream.sockets).toHaveLength(2)

    const s2 = h.upstream.sockets[1]
    s2.open()
    confirmSubs(s2)
    s2.emit('close') // still no head — backoff must have escalated despite the open()
    h.clock.advance(1999)
    expect(h.upstream.sockets).toHaveLength(2) // would already be 3 here if backoff had wrongly reset to base
    h.clock.advance(1)
    expect(h.upstream.sockets).toHaveLength(3) // base * 2^1 = 2000ms confirms escalation held

    const s3 = h.upstream.sockets[2]
    s3.open()
    confirmSubs(s3)
    sendHead(s3, 100) // first head — watcher reaches 'live', backoff resets
    s3.emit('close')
    h.clock.advance(999)
    expect(h.upstream.sockets).toHaveLength(3) // not due yet either way at 999ms
    h.clock.advance(1)
    expect(h.upstream.sockets).toHaveLength(4) // back to base * 2^0 = 1000ms — would still be 3 here if backoff had wrongly kept escalating to 4000ms
  })

  it('overlapping reconnects do not trigger duplicate gap-repair emissions', async () => {
    const h = makeHarness()
    h.upstream.deferGetLogs = true
    h.watcher.start()
    const s1 = h.upstream.sockets[0]
    s1.open()
    confirmSubs(s1)
    sendHead(s1, 100)
    s1.emit('close')
    h.clock.advance(1000)

    const s2 = h.upstream.sockets[1]
    s2.open() // triggers gap-repair(101) — deferred, stays pending
    confirmSubs(s2)
    expect(h.upstream.getLogsCalls).toHaveLength(1)
    s2.emit('close') // second disconnect while the first repair is still in flight
    h.clock.advance(2000)

    const s3 = h.upstream.sockets[2]
    s3.open() // would also want gap-repair(101) — must be SKIPPED, repair already in flight
    confirmSubs(s3)
    expect(h.upstream.getLogsCalls).toHaveLength(1) // no second eth_getLogs call fired
    expect(h.upstream.pendingGetLogsCount).toBe(1)

    h.upstream.resolvePendingGetLogs([supplyLog(101)])
    await flush()
    expect(h.events.map((e) => e.event)).toEqual(['Supply']) // emitted exactly once
    expect(h.events[0].blockNumber).toBe(101)
  })

  it('a failed gap repair keeps its fromBlock as a low-water mark for the next attempt', async () => {
    const h = makeHarness()
    h.upstream.deferGetLogs = true
    h.watcher.start()
    const s1 = h.upstream.sockets[0]
    s1.open()
    confirmSubs(s1)
    sendHead(s1, 100)
    s1.emit('close')
    h.clock.advance(1000)

    const s2 = h.upstream.sockets[1]
    s2.open() // triggers gap-repair(101) — deferred
    confirmSubs(s2)
    expect(h.upstream.getLogsCalls).toHaveLength(1)
    expect(h.upstream.getLogsCalls[0].params[0]).toMatchObject({ fromBlock: '0x65' }) // 100 + 1

    h.upstream.rejectPendingGetLogs(new Error('rate limited'))
    await flush() // repair-A settles: #repairInFlight clears, but the low-water mark (101) stays

    // More heads arrive on s2 before it disconnects again — a naive fromBlock (lastBlockSeen+1)
    // would jump straight past the never-repaired [101, 150] range.
    sendHead(s2, 150)
    s2.emit('close')
    h.clock.advance(1000) // backoff was reset to base by the live head

    const s3 = h.upstream.sockets[2]
    s3.open() // must retry the ORIGINAL failed range (101), not the naive 151
    confirmSubs(s3)
    expect(h.upstream.getLogsCalls).toHaveLength(2)
    expect(h.upstream.getLogsCalls[1].params[0]).toMatchObject({ fromBlock: '0x65' }) // still 101 — the low-water mark held

    h.upstream.resolvePendingGetLogs([])
    await flush() // success this time — the low-water mark clears

    sendHead(s3, 160)
    s3.emit('close')
    h.clock.advance(1000)

    const s4 = h.upstream.sockets[3]
    s4.open() // mark is clear — back to the ordinary lastBlockSeen+1
    confirmSubs(s4)
    expect(h.upstream.getLogsCalls).toHaveLength(3)
    expect(h.upstream.getLogsCalls[2].params[0]).toMatchObject({ fromBlock: '0xa1' }) // 160 + 1
  })

  it('stop() while the socket is still CONNECTING does not crash on the deferred handshake-abort error', async () => {
    const h = makeHarness()
    h.watcher.start()
    const s1 = h.upstream.sockets[0] // never opened — still "CONNECTING"
    await h.watcher.stop()
    expect(h.watcher.status).toBe('stopped')
    // stop() must leave a surviving 'error' listener attached BEFORE close()/terminate() ran
    // — otherwise the deferred (ws-realistic) handshake-abort error fired on a later tick
    // would be an unhandled 'error' event on the socket's EventEmitter and crash the process.
    expect(s1.listenerCount('error')).toBeGreaterThan(0)
    await flush() // let the deferred handshake-abort error + close actually fire
    expect(h.watcher.status).toBe('stopped') // nothing crashed; still stopped
    h.clock.advance(120_000)
    expect(h.upstream.sockets).toHaveLength(1) // still no reconnect
  })

  it('reconnect teardown does not crash when the old socket was still CONNECTING (e.g. watchdog-forced terminate mid-handshake)', async () => {
    const h = makeHarness()
    h.watcher.start()
    const s1 = h.upstream.sockets[0] // never opened
    s1.terminate() // mirrors what #armWatchdog's terminate() call does to a stuck socket
    await flush() // let the deferred handshake-abort error + close fire
    // At the moment 'error' fires, #connect()'s original listeners are still attached
    // (nothing has torn this socket down yet), so it is caught and logged, not unhandled.
    // #onClose's own removeAllListeners() only runs afterward, on an already-dead socket.
    expect(h.watcher.status).toBe('degraded') // teardown ran cleanly — no crash
    h.clock.advance(1000)
    expect(h.upstream.sockets).toHaveLength(2) // reconnected normally afterward
  })
})
