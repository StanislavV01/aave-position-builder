import type { FastifyInstance } from 'fastify'
import { isNetworkKey } from '@app/shared'
import { checkRpcBody } from './allowlist.js'
import { UpstreamError, type Upstream } from './upstream.js'

export interface RpcProxyOpts {
  upstream: Upstream
}

function errorBodyFor(requestBody: unknown, message: string): unknown {
  const errorFor = (id: unknown) => ({ jsonrpc: '2.0' as const, id, error: { code: -32000, message } })
  if (Array.isArray(requestBody)) {
    return requestBody.map((entry) =>
      errorFor(typeof entry === 'object' && entry !== null && 'id' in entry ? (entry as { id: unknown }).id : null),
    )
  }
  if (typeof requestBody === 'object' && requestBody !== null && 'id' in requestBody) {
    return errorFor((requestBody as { id: unknown }).id)
  }
  return errorFor(null)
}

export async function rpcProxyPlugin(app: FastifyInstance, opts: RpcProxyOpts): Promise<void> {
  // Scoped parser: broken JSON becomes body=undefined so checkRpcBody answers
  // with a JSON-RPC -32600 instead of fastify's default HTTP 400.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, payload, done) => {
    try {
      done(null, JSON.parse(payload as string))
    } catch {
      done(null, undefined)
    }
  })

  app.post('/rpc/:network', async (req, reply) => {
    const { network } = req.params as { network: string }
    if (!isNetworkKey(network)) {
      return reply.status(404).send({ error: 'unknown network' })
    }
    const check = checkRpcBody(req.body)
    if (!check.ok) {
      return reply.status(200).send(check.response)
    }
    try {
      const result = await opts.upstream.rpc(network, req.body)
      return reply.status(result.status).send(result.body)
    } catch (err) {
      // UpstreamError messages are constructed sanitized in upstream.ts; anything
      // else gets a fixed generic message so no upstream detail can leak.
      const message = err instanceof UpstreamError ? err.message : 'upstream request failed'
      req.log.warn({ msg: message }, 'rpc proxy upstream failure')
      return reply.status(502).send(errorBodyFor(req.body, message))
    }
  })
}
