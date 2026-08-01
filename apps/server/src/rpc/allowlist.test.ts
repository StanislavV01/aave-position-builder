import { describe, expect, it } from 'vitest'
import { ALLOWED_METHODS, checkRpcBody } from './allowlist.js'

describe('ALLOWED_METHODS', () => {
  it('contains exactly the 13 read methods and no send methods', () => {
    expect([...ALLOWED_METHODS].sort()).toEqual(
      [
        'eth_blockNumber',
        'eth_call',
        'eth_chainId',
        'eth_estimateGas',
        'eth_feeHistory',
        'eth_gasPrice',
        'eth_getBalance',
        'eth_getBlockByNumber',
        'eth_getCode',
        'eth_getLogs',
        'eth_getTransactionByHash',
        'eth_getTransactionReceipt',
        'eth_maxPriorityFeePerGas',
      ].sort(),
    )
    expect(ALLOWED_METHODS.has('eth_sendRawTransaction')).toBe(false)
  })
})

describe('checkRpcBody', () => {
  it('accepts a single allowed request', () => {
    expect(checkRpcBody({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] })).toEqual({ ok: true })
  })

  it('rejects a disallowed method with -32601, preserving the id', () => {
    const res = checkRpcBody({ jsonrpc: '2.0', id: 7, method: 'eth_sendRawTransaction', params: ['0x00'] })
    expect(res).toEqual({
      ok: false,
      response: { jsonrpc: '2.0', id: 7, error: { code: -32601, message: 'method not allowed: eth_sendRawTransaction' } },
    })
  })

  it('rejects malformed bodies with -32600', () => {
    for (const bad of [undefined, null, 'eth_chainId', 42, { jsonrpc: '2.0', id: 1 }, { method: 5 }]) {
      const res = checkRpcBody(bad)
      expect(res.ok).toBe(false)
      const response = (res as { ok: false; response: unknown }).response as {
        error: { code: number }
      }
      expect(response.error.code).toBe(-32600)
    }
  })

  it('accepts a batch where every entry is allowed', () => {
    expect(
      checkRpcBody([
        { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
        { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] },
      ]),
    ).toEqual({ ok: true })
  })

  it('rejects the whole batch when one entry is bad, with per-entry errors and preserved ids', () => {
    const res = checkRpcBody([
      { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'eth_sendRawTransaction', params: ['0x00'] },
    ])
    expect(res.ok).toBe(false)
    const response = (res as { ok: false; response: unknown }).response as unknown[]
    expect(response).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'batch rejected: another entry in this batch was invalid or not allowed' },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        error: { code: -32601, message: 'method not allowed: eth_sendRawTransaction' },
      },
    ])
  })

  it('rejects an empty batch with a single -32600 error', () => {
    const res = checkRpcBody([])
    expect(res).toEqual({
      ok: false,
      response: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: empty batch' } },
    })
  })
})
