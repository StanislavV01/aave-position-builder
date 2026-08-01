import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { marketByNetworkKey } from '@app/shared'
import { runDoctor } from './doctor.js'
import { UpstreamError, type RpcResult, type Upstream } from '../rpc/upstream.js'

function captureLogger() {
  const lines: { level: number; msg: string; [k: string]: unknown }[] = []
  const logger = pino({ level: 'debug' }, { write: (raw: string) => { lines.push(JSON.parse(raw)) } })
  const warns = () => lines.filter((l) => l.level >= 40)
  return { logger, lines, warns }
}

const revisionHex = (rev: bigint) => `0x${rev.toString(16).padStart(64, '0')}`
const CHAIN_ID_HEX: Record<string, string> = { base: '0x2105', 'base-sepolia': '0x14a34' }

/** Healthy-by-default stub; per-method overrides simulate faults. */
function stubUpstream(
  overrides: Partial<Record<string, (network: string) => RpcResult>> = {},
  opts: { throwOn?: string } = {},
): Upstream {
  return {
    async rpc(network, body) {
      const method = (body as { method: string }).method
      if (opts.throwOn === method) throw new UpstreamError(502, 'upstream request failed (network error)')
      const override = overrides[method]
      if (override) return override(network)
      if (method === 'eth_chainId') {
        return { status: 200, body: { jsonrpc: '2.0', id: 1, result: CHAIN_ID_HEX[network] } }
      }
      if (method === 'eth_getCode') {
        return { status: 200, body: { jsonrpc: '2.0', id: 1, result: '0x600180' } }
      }
      if (method === 'eth_call') {
        const market = marketByNetworkKey(network)
        return { status: 200, body: { jsonrpc: '2.0', id: 1, result: revisionHex(market.expectedPoolRevision) } }
      }
      throw new Error(`unexpected method ${method}`)
    },
    openSocket() {
      throw new Error('doctor never opens sockets')
    },
  }
}

describe('runDoctor', () => {
  it('logs one info row per network and no warnings when everything checks out', async () => {
    const { logger, lines, warns } = captureLogger()
    await runDoctor(stubUpstream(), logger)
    const rows = lines.filter((l) => l.msg === 'doctor')
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.network).sort()).toEqual(['base', 'base-sepolia'])
    expect(rows.every((r) => r.poolHasCode === true)).toBe(true)
    expect(warns()).toHaveLength(0)
  })

  it('warns on chainId mismatch but still resolves', async () => {
    const { logger, warns } = captureLogger()
    const upstream = stubUpstream({
      eth_chainId: () => ({ status: 200, body: { jsonrpc: '2.0', id: 1, result: '0x1' } }),
    })
    await expect(runDoctor(upstream, logger)).resolves.toBeUndefined()
    expect(warns().some((l) => l.msg.includes('chainId mismatch'))).toBe(true)
  })

  it('warns on POOL_REVISION mismatch but still resolves', async () => {
    const { logger, warns } = captureLogger()
    const upstream = stubUpstream({
      eth_call: () => ({ status: 200, body: { jsonrpc: '2.0', id: 1, result: revisionHex(99n) } }),
    })
    await expect(runDoctor(upstream, logger)).resolves.toBeUndefined()
    expect(warns().some((l) => l.msg.includes('POOL_REVISION mismatch'))).toBe(true)
  })

  it('warns and continues when the upstream is down — never throws', async () => {
    const { logger, warns } = captureLogger()
    await expect(runDoctor(stubUpstream({}, { throwOn: 'eth_chainId' }), logger)).resolves.toBeUndefined()
    expect(warns().filter((l) => l.msg.includes('doctor: upstream check failed'))).toHaveLength(2)
  })
})
