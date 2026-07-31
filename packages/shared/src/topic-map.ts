// Single source of truth mapping Pool events -> which indexed topic carries the
// position owner. Used by the WS hub (in-memory user matching), the activity API
// (log filters), and the web live client. topic0 hashes are COMPUTED from the
// vendored ABI via toEventSelector — never hand-copied.
import { getAddress, toEventSelector } from 'viem'
import type { Address, Hex } from 'viem'
import { POOL_ABI } from './abis/pool'
import type { PoolAbiEvent } from './abis/pool'

export type PositionEventName =
  | 'Supply'
  | 'Borrow'
  | 'Repay'
  | 'Withdraw'
  | 'LiquidationCall'
  | 'ReserveUsedAsCollateralEnabled'
  | 'ReserveUsedAsCollateralDisabled'
  | 'UserEModeSet'

export interface PositionEventDef {
  name: PositionEventName
  topic0: Hex
  userTopicIndex: 1 | 2 | 3
}

function poolEvent(name: string): PoolAbiEvent {
  const item = POOL_ABI.find(
    (entry): entry is PoolAbiEvent => entry.type === 'event' && entry.name === name,
  )
  if (item === undefined) throw new Error(`POOL_ABI is missing event definition: ${name}`)
  return item
}

// Owner topic per v3 Pool event definitions:
//   Supply/Borrow -> onBehalfOf = topic2 (the non-indexed `user` param is the CALLER)
//   Repay/Withdraw/ReserveUsedAsCollateral{En,Dis}abled -> user = topic2
//   LiquidationCall -> user = topic3; UserEModeSet -> user = topic1
const EVENT_USER_TOPIC_INDEX: readonly { name: PositionEventName; userTopicIndex: 1 | 2 | 3 }[] = [
  { name: 'Supply', userTopicIndex: 2 },
  { name: 'Borrow', userTopicIndex: 2 },
  { name: 'Repay', userTopicIndex: 2 },
  { name: 'Withdraw', userTopicIndex: 2 },
  { name: 'LiquidationCall', userTopicIndex: 3 },
  { name: 'ReserveUsedAsCollateralEnabled', userTopicIndex: 2 },
  { name: 'ReserveUsedAsCollateralDisabled', userTopicIndex: 2 },
  { name: 'UserEModeSet', userTopicIndex: 1 },
]

export const POSITION_EVENTS: readonly PositionEventDef[] = EVENT_USER_TOPIC_INDEX.map(
  ({ name, userTopicIndex }) => ({ name, topic0: toEventSelector(poolEvent(name)), userTopicIndex }),
)

export const POSITION_EVENT_TOPIC0S: readonly Hex[] = POSITION_EVENTS.map((def) => def.topic0)

export const RESERVE_DATA_UPDATED_TOPIC0: Hex = toEventSelector(poolEvent('ReserveDataUpdated'))

// The server's reserve-data cache busts on ANY of these; only POSITION_EVENT_TOPIC0S
// are user-relevant. ReserveDataUpdated has no user and never produces a push.
export const CACHE_INVALIDATION_TOPIC0S: readonly Hex[] = [
  ...POSITION_EVENT_TOPIC0S,
  RESERVE_DATA_UPDATED_TOPIC0,
]

const EVENT_BY_TOPIC0: ReadonlyMap<string, PositionEventDef> = new Map(
  POSITION_EVENTS.map((def): [string, PositionEventDef] => [def.topic0.toLowerCase(), def]),
)

export function extractUserFromLog(
  topics: readonly Hex[],
): { event: PositionEventName; user: Address } | null {
  const topic0 = topics[0]
  if (topic0 === undefined) return null
  const def = EVENT_BY_TOPIC0.get(topic0.toLowerCase())
  if (def === undefined) return null
  const userTopic = topics[def.userTopicIndex]
  if (userTopic === undefined || userTopic.length !== 66) return null
  return { event: def.name, user: getAddress(`0x${userTopic.slice(26)}`) }
}
