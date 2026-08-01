import { existsSync } from 'node:fs'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'
import { runDoctor } from './doctor.js'
import { loadEnv } from './env.js'
import { healthPlugin } from './health.js'
import { makeLogger } from './logger.js'
import { rpcProxyPlugin } from './rpc-proxy.js'
import { makeUpstream } from './upstream.js'
import { Hub } from './ws/hub.js'
import { wsRoutePlugin } from './ws/route.js'
import { NetworkWatcher } from './ws/watcher.js'

// .env lives at the repo root; `pnpm --filter @app/server dev` runs with cwd=apps/server.
for (const candidate of ['.env', '../../.env']) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate)
    break
  }
}

const env = loadEnv()
const log = makeLogger()
const upstream = makeUpstream(env)
const hub = new Hub({
  log: log.child({ mod: 'hub' }),
  makeWatcher: (market) =>
    new NetworkWatcher({
      upstream,
      market,
      log: log.child({ mod: 'watcher', network: market.networkKey }),
    }),
})

const app = Fastify({ loggerInstance: log.child({ mod: 'http' }) })

// Rate limit applies to /rpc ONLY: the limiter is registered inside the same
// encapsulation context as the proxy plugin, so /health and /ws are untouched.
await app.register(async (scope) => {
  await scope.register(rateLimit, { max: 200, timeWindow: '1 minute' })
  await scope.register(rpcProxyPlugin, { upstream })
})
await app.register(wsRoutePlugin, { hub })
await app.register(healthPlugin, { hub, startedAtMs: Date.now() })

await app.listen({ port: env.PORT, host: env.HOST })
log.info({ port: env.PORT, host: env.HOST }, 'server listening')

// Fire and forget: the doctor warns, it never gates startup.
void runDoctor(upstream, log.child({ mod: 'doctor' }))

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  log.info({ signal }, 'shutting down')
  const hardExit = setTimeout(() => {
    log.error('graceful shutdown timed out — hard exit')
    process.exit(1)
  }, 10_000)
  hardExit.unref()
  await hub.close() // 1001 to WS clients, stop watchers (closes upstream wss)
  await app.close() // drains in-flight proxy requests
  process.exit(0)
}
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
