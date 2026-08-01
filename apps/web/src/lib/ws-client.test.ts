import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveClient } from './ws-client'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readyState = 0
  sent: string[] = []
  private listeners: Record<string, ((ev: { data?: unknown }) => void)[]> = {}
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  addEventListener(type: 'open' | 'message' | 'close' | 'error', cb: (ev: { data?: unknown }) => void): void {
    ;(this.listeners[type] ??= []).push(cb)
  }
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.fireClose()
  }
  fire(type: string, ev: { data?: unknown } = {}): void {
    for (const cb of this.listeners[type] ?? []) cb(ev)
  }
  fireOpen(): void {
    this.readyState = 1
    this.fire('open')
  }
  fireMessage(obj: unknown): void {
    this.fire('message', { data: JSON.stringify(obj) })
  }
  fireClose(): void {
    this.readyState = 3
    this.fire('close')
  }
}

const ADDR = '0x1111111111111111111111111111111111111111' as `0x${string}`
const newClient = () =>
  new LiveClient('ws://test/ws', { WebSocketImpl: FakeWebSocket, backoffBaseMs: 1000, backoffCapMs: 15000 })

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
})
afterEach(() => {
  vi.useRealTimers()
})

describe('LiveClient', () => {
  it('queues watch until the socket opens, then sends the versioned message', () => {
    const c = newClient()
    c.watch('base-sepolia', ADDR)
    const ws = FakeWebSocket.instances[0]
    expect(ws.sent).toHaveLength(0)
    ws.fireOpen()
    expect(ws.sent).toHaveLength(1)
    expect(JSON.parse(ws.sent[0])).toEqual({ v: 1, type: 'watch', network: 'base-sepolia', address: ADDR })
    c.close()
  })

  it('reconnects with backoff and re-sends watches after reconnect', () => {
    const statuses: string[] = []
    const c = newClient()
    c.onStatus((s) => statuses.push(s))
    c.watch('base-sepolia', ADDR)
    const ws1 = FakeWebSocket.instances[0]
    ws1.fireOpen()
    ws1.fireClose()
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(999)
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(2)
    const ws2 = FakeWebSocket.instances[1]
    ws2.fireOpen()
    expect(JSON.parse(ws2.sent[0])).toEqual({ v: 1, type: 'watch', network: 'base-sepolia', address: ADDR })
    expect(statuses).toEqual(['live', 'degraded', 'live'])
    c.close()
  })

  it('reports disconnected after two consecutive failed connects, keeps retrying', () => {
    const statuses: string[] = []
    const c = newClient()
    c.onStatus((s) => statuses.push(s))
    FakeWebSocket.instances[0].fireClose() // failed connect #1
    expect(statuses).toEqual(['degraded'])
    vi.advanceTimersByTime(1000)
    FakeWebSocket.instances[1].fireClose() // failed connect #2
    expect(statuses).toEqual(['degraded', 'disconnected'])
    vi.advanceTimersByTime(2000) // backoff doubled
    expect(FakeWebSocket.instances).toHaveLength(3)
    c.close()
  })

  it('forwards server status transitions live→degraded→live', () => {
    const statuses: string[] = []
    const c = newClient()
    c.onStatus((s) => statuses.push(s))
    const ws = FakeWebSocket.instances[0]
    ws.fireOpen()
    ws.fireMessage({ v: 1, type: 'status', network: 'base-sepolia', state: 'degraded' })
    ws.fireMessage({ v: 1, type: 'status', network: 'base-sepolia', state: 'live' })
    expect(statuses).toEqual(['live', 'degraded', 'live'])
    c.close()
  })

  it('delivers position-events and ignores malformed frames', () => {
    const events: unknown[] = []
    const c = newClient()
    c.onEvent((e) => events.push(e))
    const ws = FakeWebSocket.instances[0]
    ws.fireOpen()
    ws.fire('message', { data: 'not-json{{' }) // must not throw
    const evt = {
      v: 1, type: 'position-event', network: 'base-sepolia', address: ADDR,
      event: 'Supply', txHash: '0xdead', blockNumber: 42,
    }
    ws.fireMessage(evt)
    expect(events).toEqual([evt])
    c.close()
  })

  it('close() stops reconnecting for good', () => {
    const c = newClient()
    const ws = FakeWebSocket.instances[0]
    ws.fireOpen()
    c.close()
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
