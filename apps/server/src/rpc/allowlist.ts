export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'eth_call',
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getBalance',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_getLogs',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_getCode',
])

export type RpcCheck = { ok: true } | { ok: false; response: unknown }

interface JsonRpcError {
  jsonrpc: '2.0'
  id: unknown
  error: { code: number; message: string }
}

function idOf(entry: unknown): unknown {
  if (typeof entry === 'object' && entry !== null && !Array.isArray(entry) && 'id' in entry) {
    return (entry as Record<string, unknown>).id
  }
  return null
}

/** Returns null when the entry is a valid, allowed JSON-RPC request. */
function errorFor(entry: unknown): JsonRpcError | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
  }
  const record = entry as Record<string, unknown>
  if (typeof record.method !== 'string') {
    return { jsonrpc: '2.0', id: idOf(entry), error: { code: -32600, message: 'Invalid Request: missing method' } }
  }
  if (!ALLOWED_METHODS.has(record.method)) {
    return {
      jsonrpc: '2.0',
      id: idOf(entry),
      error: { code: -32601, message: `method not allowed: ${record.method}` },
    }
  }
  return null
}

export function checkRpcBody(body: unknown): RpcCheck {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return {
        ok: false,
        response: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: empty batch' } },
      }
    }
    const errors = body.map(errorFor)
    if (errors.every((e) => e === null)) {
      return { ok: true }
    }
    const response = body.map((entry, i) => {
      const err = errors[i]
      if (err !== null) return err
      return {
        jsonrpc: '2.0' as const,
        id: idOf(entry),
        error: { code: -32600, message: 'batch rejected: another entry in this batch was invalid or not allowed' },
      }
    })
    return { ok: false, response }
  }
  const err = errorFor(body)
  return err === null ? { ok: true } : { ok: false, response: err }
}
