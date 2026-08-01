import type { FastifyInstance } from 'fastify'
import type { NetworkKey } from '@app/shared'
import type { Hub } from '../ws/hub.js'

export interface HealthOpts {
  hub: Hub
  startedAtMs: number
}

const NETWORK_KEYS: readonly NetworkKey[] = ['base', 'base-sepolia']

export async function healthPlugin(app: FastifyInstance, opts: HealthOpts): Promise<void> {
  app.get('/health', async (_req, reply) => {
    const networks: Record<string, unknown> = {}
    let degraded = false
    for (const key of NETWORK_KEYS) {
      const status = opts.hub.networkStatus(key)
      networks[key] = status
      if (status !== null && status.ws === 'degraded') degraded = true
    }
    return reply.status(degraded ? 503 : 200).send({
      status: degraded ? 'degraded' : 'ok',
      uptimeSec: Math.floor((Date.now() - opts.startedAtMs) / 1000),
      networks,
    })
  })
}
