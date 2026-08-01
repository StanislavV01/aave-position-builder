import type pino from 'pino'
import { decodeFunctionResult, encodeFunctionData, type Hex } from 'viem'
import { MARKETS } from '@app/shared'
import type { Upstream } from '../rpc/upstream.js'

// Selector is computed by viem from this fragment — never hand-copied.
const POOL_REVISION_ABI = [
  {
    type: 'function',
    name: 'POOL_REVISION',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

/**
 * Startup doctor: per network, check DRPC reachability (eth_chainId), that the
 * Pool proxy has code, and that POOL_REVISION matches the pinned expectation.
 * Warn-and-continue on every failure — the doctor must never break the demo.
 */
export async function runDoctor(upstream: Upstream, log: pino.Logger): Promise<void> {
  for (const market of MARKETS) {
    const row: Record<string, unknown> = { network: market.networkKey }
    try {
      const chainIdRes = await upstream.rpc(market.networkKey, {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: [],
      })
      const chainIdHex = (chainIdRes.body as { result?: string }).result
      row.chainId = chainIdHex ?? 'unknown'
      if (typeof chainIdHex !== 'string' || Number.parseInt(chainIdHex, 16) !== market.chainId) {
        log.warn(
          { network: market.networkKey, got: chainIdHex ?? null, expected: market.chainId },
          'doctor: chainId mismatch',
        )
      }

      const codeRes = await upstream.rpc(market.networkKey, {
        jsonrpc: '2.0',
        id: 2,
        method: 'eth_getCode',
        params: [market.pool, 'latest'],
      })
      const code = (codeRes.body as { result?: string }).result
      row.poolHasCode = typeof code === 'string' && code !== '0x' && code !== ''
      if (row.poolHasCode !== true) {
        log.warn({ network: market.networkKey, pool: market.pool }, 'doctor: POOL has no code — address drift?')
      }

      const revisionRes = await upstream.rpc(market.networkKey, {
        jsonrpc: '2.0',
        id: 3,
        method: 'eth_call',
        params: [
          { to: market.pool, data: encodeFunctionData({ abi: POOL_REVISION_ABI, functionName: 'POOL_REVISION' }) },
          'latest',
        ],
      })
      const revisionHex = (revisionRes.body as { result?: Hex }).result
      const revision =
        typeof revisionHex === 'string' && revisionHex !== '0x'
          ? decodeFunctionResult({ abi: POOL_REVISION_ABI, functionName: 'POOL_REVISION', data: revisionHex })
          : null
      row.poolRevision = revision === null ? 'unknown' : revision.toString()
      if (revision !== null && revision !== market.expectedPoolRevision) {
        log.warn(
          {
            network: market.networkKey,
            got: revision.toString(),
            expected: market.expectedPoolRevision.toString(),
          },
          'doctor: POOL_REVISION mismatch — the testnet market may have been upgraded or redeployed',
        )
      }
    } catch (err) {
      log.warn(
        { network: market.networkKey, reason: err instanceof Error ? err.message : 'unknown' },
        'doctor: upstream check failed — continuing (warn-and-continue by design)',
      )
    }
    log.info(row, 'doctor')
  }
}
