import { parseAbi } from 'viem'

// Used with viem's multicall (Multicall3 at 0xcA11bde05977b3631167028862bE2a173976CA11
// on both networks — viem's default) to fetch true reserve ids:
// AggregatedReserveData has no `id` field and Pool.getReservesList() compacts dropped
// reserves, so array index == reserve id ONLY if nothing was ever dropped. eMode bitmaps
// index by TRUE reserve id — always resolve ids through getReserveAddressById.
export const GET_RESERVE_ADDRESS_BY_ID_ABI = parseAbi([
  'function getReserveAddressById(uint16 id) view returns (address)',
])
