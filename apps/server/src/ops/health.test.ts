import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import type { NetworkKey } from '@app/shared'
import { healthPlugin } from './health.js'
import type { Hub } from '../ws/hub.js'
import type { WatcherStatus } from '../ws/watcher.js'

type NetStatus = { ws: WatcherStatus; lastBlockSeen: number | null; lastBlockAtMs: number | null }

function stubHub(statuses: Partial<Record<NetworkKey, NetStatus>>): Hub {
  return { networkStatus: (key: NetworkKey) => statuses[key] ?? null } as unknown as Hub
}

async function buildApp(hub: Hub) {
  const app = Fastify({ logger: false })
  await app.register(healthPlugin, { hub, startedAtMs: Date.now() - 5000 })
  return app
}

describe('GET /health', () => {
  it('returns 200 ok when no network is watched', async () => {
    const app = await buildApp(stubHub({}))
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('ok')
    expect(body.networks).toEqual({ base: null, 'base-sepolia': null })
    expect(typeof body.uptimeSec).toBe('number')
    expect(body.uptimeSec).toBeGreaterThanOrEqual(5)
  })

  it('returns 200 with detail while a watched network is live', async () => {
    const app = await buildApp(
      stubHub({ 'base-sepolia': { ws: 'live', lastBlockSeen: 123, lastBlockAtMs: 456 } }),
    )
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json().networks['base-sepolia']).toEqual({ ws: 'live', lastBlockSeen: 123, lastBlockAtMs: 456 })
  })

  it('returns 503 degraded with network detail when a watched network is degraded', async () => {
    const app = await buildApp(
      stubHub({
        base: { ws: 'live', lastBlockSeen: 999, lastBlockAtMs: 1 },
        'base-sepolia': { ws: 'degraded', lastBlockSeen: 100, lastBlockAtMs: 2 },
      }),
    )
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(503)
    const body = res.json()
    expect(body.status).toBe('degraded')
    expect(body.networks['base-sepolia'].ws).toBe('degraded')
    expect(body.networks.base.ws).toBe('live')
  })

  it('does not 503 for a network that is merely connecting', async () => {
    const app = await buildApp(
      stubHub({ base: { ws: 'connecting', lastBlockSeen: null, lastBlockAtMs: null } }),
    )
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
  })
})
