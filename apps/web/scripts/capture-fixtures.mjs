// Run: pnpm --filter @app/web exec tsx scripts/capture-fixtures.mjs
// Requires the server running on :8787 with a valid DRPC_KEY.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeFunctionResult, encodeFunctionData } from 'viem'
import { POOL_ABI, UI_POOL_DATA_PROVIDER_ABI, getEModesAbi, getReservesDataAbi, marketByNetworkKey } from '@app/shared'

const market = marketByNetworkKey('base-sepolia')
const RPC = 'http://localhost:8787/rpc/base-sepolia'
let nextId = 1

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  })
  if (!res.ok) throw new Error(`proxy HTTP ${res.status} — is the server running on :8787?`)
  const json = await res.json()
  if (json.error) throw new Error(`${method} failed: ${JSON.stringify(json.error)}`)
  return json.result
}

const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest'])

const blockHex = await rpc('eth_blockNumber', [])

const reservesDataHex = await call(
  market.uiPoolDataProvider,
  encodeFunctionData({ abi: getReservesDataAbi(market.networkKey), functionName: 'getReservesData', args: [market.poolAddressesProvider] }),
)
const eModesHex = await call(
  market.uiPoolDataProvider,
  encodeFunctionData({ abi: getEModesAbi('base-sepolia'), functionName: 'getEModes', args: [market.poolAddressesProvider] }),
)
const listHex = await call(
  market.uiPoolDataProvider,
  encodeFunctionData({ abi: UI_POOL_DATA_PROVIDER_ABI, functionName: 'getReservesList', args: [market.poolAddressesProvider] }),
)
const list = decodeFunctionResult({ abi: UI_POOL_DATA_PROVIDER_ABI, functionName: 'getReservesList', data: listHex })

const reserveIds = {}
for (let id = 0; id < list.length + 8; id++) {
  const hex = await call(
    market.pool,
    encodeFunctionData({ abi: POOL_ABI, functionName: 'getReserveAddressById', args: [id] }),
  )
  const addr = decodeFunctionResult({ abi: POOL_ABI, functionName: 'getReserveAddressById', data: hex })
  if (addr !== '0x0000000000000000000000000000000000000000') reserveIds[addr.toLowerCase()] = id
}

const out = {
  network: 'base-sepolia',
  chainId: 84532,
  capturedAtBlock: blockHex,
  capturedAt: new Date().toISOString(),
  reservesDataHex,
  eModesHex,
  reserveIds,
}
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'data', '__fixtures__')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'base-sepolia.json'), JSON.stringify(out, null, 2) + '\n')
console.log(`wrote base-sepolia.json at block ${Number(blockHex)} with ${Object.keys(reserveIds).length} reserve ids`)
