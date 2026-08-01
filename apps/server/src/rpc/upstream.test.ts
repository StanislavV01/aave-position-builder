import { describe, expect, it } from 'vitest'
import { makeUpstream, UpstreamError } from './upstream.js'

const KEY = 'CANARY_test_key_123'
const ENV = { DRPC_KEY: KEY, DRPC_HTTP_BASE: 'https://rpc.example.test', DRPC_WSS_BASE: 'wss://rpc.example.test' }

function fetchSpy(makeResponse: () => Response) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return makeResponse()
  }) as typeof fetch
  return { calls, impl }
}

describe('makeUpstream', () => {
  it('POSTs JSON to {base}/{network} with the Drpc-Key header', async () => {
    const { calls, impl } = fetchSpy(
      () => new Response('{"jsonrpc":"2.0","id":1,"result":"0x14a34"}', { status: 200 }),
    )
    const upstream = makeUpstream(ENV, { fetchImpl: impl })
    const result = await upstream.rpc('base-sepolia', { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://rpc.example.test/base-sepolia')
    expect(calls[0].init.method).toBe('POST')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['Drpc-Key']).toBe(KEY)
    expect(headers['content-type']).toBe('application/json')
    expect(calls[0].init.body).toBe('{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}')
    expect(result).toEqual({ status: 200, body: { jsonrpc: '2.0', id: 1, result: '0x14a34' } })
  })

  it('maps upstream 401 to UpstreamError(502) with no key material anywhere on the error', async () => {
    const { impl } = fetchSpy(() => new Response('unauthorized: bad Drpc-Key', { status: 401 }))
    const upstream = makeUpstream(ENV, { fetchImpl: impl })
    const err = await upstream.rpc('base', { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UpstreamError)
    expect((err as UpstreamError).status).toBe(502)
    const flat = JSON.stringify({
      message: (err as Error).message,
      stack: (err as Error).stack,
      own: Object.getOwnPropertyNames(err as object),
      json: err,
    })
    expect(flat).not.toContain(KEY)
  })

  it('maps a thrown network error to UpstreamError(502) without wrapping the original error', async () => {
    const impl = (async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { requestHeaders: { 'Drpc-Key': KEY } })
    }) as typeof fetch
    const upstream = makeUpstream(ENV, { fetchImpl: impl })
    const err = await upstream.rpc('base', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UpstreamError)
    expect((err as UpstreamError).status).toBe(502)
    expect((err as Error).message).toBe('upstream request failed (network error)')
    expect(JSON.stringify(err)).not.toContain(KEY)
    expect((err as { cause?: unknown }).cause).toBeUndefined()
  })

  it('maps a non-JSON upstream body to UpstreamError(502)', async () => {
    const { impl } = fetchSpy(() => new Response('<html>gateway error</html>', { status: 200 }))
    const upstream = makeUpstream(ENV, { fetchImpl: impl })
    const err = await upstream.rpc('base', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UpstreamError)
    expect((err as UpstreamError).status).toBe(502)
  })

  it('the returned object has no enumerable property containing the key', () => {
    const upstream = makeUpstream(ENV, { fetchImpl: (async () => new Response('{}')) as typeof fetch })
    expect(JSON.stringify(upstream)).not.toContain(KEY)
    expect(JSON.stringify(Object.getOwnPropertyNames(upstream))).not.toContain('DRPC_KEY')
  })

  it('openSocket targets {wssBase}/{network} and passes the key ONLY via header options', () => {
    const made: { url: string; headers: Record<string, string> }[] = []
    const upstream = makeUpstream(ENV, {
      fetchImpl: (async () => new Response('{}')) as typeof fetch,
      makeSocket: (url, headers) => {
        made.push({ url, headers })
        return {} as import('ws').WebSocket
      },
    })
    upstream.openSocket('base')
    expect(made).toEqual([{ url: 'wss://rpc.example.test/base', headers: { 'Drpc-Key': KEY } }])
    expect(made[0].url).not.toContain(KEY)
  })
})
