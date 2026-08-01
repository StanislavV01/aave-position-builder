import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { Hub } from './hub.js'
import { wsRoutePlugin } from './route.js'

describe('GET /ws', () => {
  it('upgrades the connection and the hub greets with hello', async () => {
    const hub = new Hub({
      heartbeatSec: 7,
      log: pino({ level: 'silent' }),
      makeWatcher: () => {
        throw new Error('no watch message is sent in this test')
      },
    })
    const app = Fastify({ logger: false })
    await app.register(wsRoutePlugin, { hub })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as { port: number }
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    const first = await new Promise<unknown>((resolve, reject) => {
      socket.on('message', (raw) => resolve(JSON.parse(String(raw))))
      socket.on('error', reject)
    })
    expect(first).toEqual({ v: 1, type: 'hello', heartbeatSec: 7 })
    socket.close()
    await hub.close()
    await app.close()
  })
})
