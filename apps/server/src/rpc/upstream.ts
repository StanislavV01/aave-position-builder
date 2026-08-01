import { WebSocket } from 'ws'
import type { NetworkKey } from '@app/shared'
import type { Env } from '../config/env.js'

export interface RpcResult {
  status: number
  body: unknown
}

export interface Upstream {
  rpc(network: NetworkKey, body: unknown, signal?: AbortSignal): Promise<RpcResult>
  openSocket(network: NetworkKey): WebSocket
}

export class UpstreamError extends Error {
  constructor(
    public status: number,
    safeMessage: string,
  ) {
    super(safeMessage)
    this.name = 'UpstreamError'
  }
}

export interface UpstreamTestDeps {
  fetchImpl?: typeof fetch
  makeSocket?: (url: string, headers: Record<string, string>) => WebSocket
}

/**
 * DRPC_KEY enters here and ONLY here. It is captured in a closure and never
 * assigned to any property of the returned object. Errors thrown from this
 * module are always fresh UpstreamError instances with fixed messages —
 * never re-thrown fetch/undici errors, which can carry request headers.
 */
export function makeUpstream(
  env: Pick<Env, 'DRPC_KEY' | 'DRPC_HTTP_BASE' | 'DRPC_WSS_BASE'>,
  deps: UpstreamTestDeps = {},
): Upstream {
  const key = env.DRPC_KEY
  const httpBase = env.DRPC_HTTP_BASE.replace(/\/$/, '')
  const wssBase = env.DRPC_WSS_BASE.replace(/\/$/, '')
  const doFetch = deps.fetchImpl ?? fetch
  const makeSocket =
    deps.makeSocket ?? ((url: string, headers: Record<string, string>) => new WebSocket(url, { headers }))

  return {
    async rpc(network, body, signal) {
      let res: Response
      try {
        res = await doFetch(`${httpBase}/${network}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'Drpc-Key': key },
          body: JSON.stringify(body),
          signal,
        })
      } catch {
        throw new UpstreamError(502, 'upstream request failed (network error)')
      }
      if (res.status === 401 || res.status === 403) {
        throw new UpstreamError(502, 'upstream rejected credentials (server-side configuration issue)')
      }
      let parsed: unknown
      try {
        parsed = await res.json()
      } catch {
        throw new UpstreamError(502, `upstream returned a non-JSON response (status ${res.status})`)
      }
      return { status: res.status, body: parsed }
    },
    openSocket(network) {
      return makeSocket(`${wssBase}/${network}`, { 'Drpc-Key': key })
    },
  }
}
