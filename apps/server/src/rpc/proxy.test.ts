import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { rpcProxyPlugin } from './proxy.js'
import { UpstreamError, type RpcResult, type Upstream } from './upstream.js'

type StubUpstream = Upstream & { calls: { network: string; body: unknown }[] }

function stubUpstream(handler?: (network: string, body: unknown) => Promise<RpcResult>): StubUpstream {
  const calls: { network: string; body: unknown }[] = []
  return {
    calls,
    async rpc(network, body) {
      calls.push({ network, body })
      if (handler) return handler(network, body)
      const id = typeof body === 'object' && body !== null && 'id' in body ? (body as { id: unknown }).id : null
      return { status: 200, body: { jsonrpc: '2.0', id, result: '0xok' } }
    },
    openSocket() {
      throw new Error('openSocket is not used by the proxy')
    },
  }
}

async function buildApp(upstream: Upstream) {
  const app = Fastify({ logger: false })
  await app.register(rpcProxyPlugin, { upstream })
  return app
}

describe('POST /rpc/:network', () => {
  it('forwards an allowed request and passes the upstream body/status through', async () => {
    const upstream = stubUpstream()
    const app = await buildApp(upstream)
    const res = await app.inject({
      method: 'POST',
      url: '/rpc/base',
      payload: { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jsonrpc: '2.0', id: 1, result: '0xok' })
    expect(upstream.calls).toEqual([
      { network: 'base', body: { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] } },
    ])
  })

  it('blocks eth_sendRawTransaction with -32601 and never forwards it', async () => {
    const upstream = stubUpstream()
    const app = await buildApp(upstream)
    const res = await app.inject({
      method: 'POST',
      url: '/rpc/base-sepolia',
      payload: { jsonrpc: '2.0', id: 9, method: 'eth_sendRawTransaction', params: ['0x00'] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      jsonrpc: '2.0',
      id: 9,
      error: { code: -32601, message: 'method not allowed: eth_sendRawTransaction' },
    })
    expect(upstream.calls).toHaveLength(0)
  })

  it('returns -32600 for a body that is valid JSON but not JSON-RPC', async () => {
    const app = await buildApp(stubUpstream())
    const res = await app.inject({ method: 'POST', url: '/rpc/base', payload: { foo: 1 } })
    expect(res.statusCode).toBe(200)
    expect(res.json().error.code).toBe(-32600)
  })

  it('returns -32600 (not HTTP 400) for unparseable JSON', async () => {
    const app = await buildApp(stubUpstream())
    const res = await app.inject({
      method: 'POST',
      url: '/rpc/base',
      payload: 'this is { not json',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().error.code).toBe(-32600)
  })

  it('forwards an all-good batch as a single upstream call', async () => {
    const upstream = stubUpstream(async (_n, body) => ({
      status: 200,
      body: (body as unknown[]).map((e) => ({ jsonrpc: '2.0', id: (e as { id: unknown }).id, result: '0x1' })),
    }))
    const app = await buildApp(upstream)
    const batch = [
      { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] },
    ]
    const res = await app.inject({ method: 'POST', url: '/rpc/base', payload: batch })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(2)
    expect(upstream.calls).toHaveLength(1)
  })

  it('rejects the whole batch when one entry is disallowed, ids preserved, nothing forwarded', async () => {
    const upstream = stubUpstream()
    const app = await buildApp(upstream)
    const res = await app.inject({
      method: 'POST',
      url: '/rpc/base',
      payload: [
        { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [] },
        { jsonrpc: '2.0', id: 2, method: 'eth_sendRawTransaction', params: ['0x00'] },
      ],
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { id: unknown; error: { code: number } }[]
    expect(body.map((e) => e.id)).toEqual([1, 2])
    expect(body.map((e) => e.error.code)).toEqual([-32600, -32601])
    expect(upstream.calls).toHaveLength(0)
  })

  it('returns 404 for an unknown network', async () => {
    const upstream = stubUpstream()
    const app = await buildApp(upstream)
    const res = await app.inject({
      method: 'POST',
      url: '/rpc/mainnet',
      payload: { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'unknown network' })
    expect(upstream.calls).toHaveLength(0)
  })

  it('maps UpstreamError to a 502 sanitized JSON-RPC error, id preserved', async () => {
    const upstream = stubUpstream(async () => {
      throw new UpstreamError(502, 'upstream rejected credentials (server-side configuration issue)')
    })
    const app = await buildApp(upstream)
    const res = await app.inject({
      method: 'POST',
      url: '/rpc/base',
      payload: { jsonrpc: '2.0', id: 42, method: 'eth_chainId', params: [] },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toEqual({
      jsonrpc: '2.0',
      id: 42,
      error: { code: -32000, message: 'upstream rejected credentials (server-side configuration issue)' },
    })
  })

  it('maps an unexpected upstream throw to a generic 502 without leaking the error', async () => {
    const upstream = stubUpstream(async () => {
      throw new Error('ECONNREFUSED 1.2.3.4:443 header Drpc-Key: super-secret')
    })
    const app = await buildApp(upstream)
    const res = await app.inject({
      method: 'POST',
      url: '/rpc/base',
      payload: { jsonrpc: '2.0', id: 5, method: 'eth_chainId', params: [] },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toEqual({ jsonrpc: '2.0', id: 5, error: { code: -32000, message: 'upstream request failed' } })
    expect(res.body).not.toContain('super-secret')
  })
})
