import { describe, expect, it } from 'vitest'
import type { Hex } from 'viem'
import {
  CACHE_INVALIDATION_TOPIC0S, POSITION_EVENTS, POSITION_EVENT_TOPIC0S, RESERVE_DATA_UPDATED_TOPIC0,
  extractUserFromLog,
} from './topic-map'

// Hardcoded hex = drift detection (same values asserted in abis/pool.test.ts).
const TOPIC0 = {
  Supply: '0x2b627736bca15cd5381dcf80b0bf11fd197d01a037c52b927a881a10fb73ba61',
  Borrow: '0xb3d084820fb1a9decffb176436bd02558d15fac9b0ddfed8c465bc7359d7dce0',
  Repay: '0xa534c8dbe71f871f9f3530e97a74601fea17b426cae02e1c5aee42c96c784051',
  Withdraw: '0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7',
  LiquidationCall: '0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286',
  ReserveUsedAsCollateralEnabled: '0x00058a56ea94653cdf4f152d227ace22d4c00ad99e2a43f58cb7d9e3feb295f2',
  ReserveUsedAsCollateralDisabled: '0x44c58d81365b66dd4b1a7f36c25aa97b8c71c361ee4937adc1a00000227db5dd',
  UserEModeSet: '0xd728da875fc88944cbf17638bcbe4af0eedaef63becd1d1c57cc097eb4608d84',
  ReserveDataUpdated: '0x804c9b842b2748a22bb64b345453a3de7ca54a6ca45ce00d415894979e22897a',
} as const

const USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const OTHER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const RESERVE = '0x4200000000000000000000000000000000000006'

const pad = (address: string): Hex => `0x000000000000000000000000${address.slice(2).toLowerCase()}` as Hex
const padUint = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}` as Hex

describe('POSITION_EVENTS', () => {
  it('covers exactly the 8 position events with computed topic0s', () => {
    expect(POSITION_EVENTS).toHaveLength(8)
    for (const def of POSITION_EVENTS) {
      expect(def.topic0, def.name).toBe(TOPIC0[def.name])
    }
    expect(new Set(POSITION_EVENT_TOPIC0S).size).toBe(8)
  })
  it('POSITION_EVENT_TOPIC0S excludes ReserveDataUpdated; CACHE_INVALIDATION_TOPIC0S includes it', () => {
    expect(POSITION_EVENT_TOPIC0S).not.toContain(TOPIC0.ReserveDataUpdated)
    expect(CACHE_INVALIDATION_TOPIC0S).toContain(TOPIC0.ReserveDataUpdated)
    expect(RESERVE_DATA_UPDATED_TOPIC0).toBe(TOPIC0.ReserveDataUpdated)
    expect(CACHE_INVALIDATION_TOPIC0S).toHaveLength(9)
    for (const t of POSITION_EVENT_TOPIC0S) expect(CACHE_INVALIDATION_TOPIC0S).toContain(t)
  })
})

describe('extractUserFromLog (synthetic logs, user padded into the correct topic)', () => {
  const cases: { name: string; topics: Hex[]; expected: string }[] = [
    { name: 'Supply: onBehalfOf at topic2', topics: [TOPIC0.Supply, pad(RESERVE), pad(USER), padUint(0)], expected: USER },
    { name: 'Borrow: onBehalfOf at topic2', topics: [TOPIC0.Borrow, pad(RESERVE), pad(USER), padUint(0)], expected: USER },
    { name: 'Repay: user at topic2', topics: [TOPIC0.Repay, pad(RESERVE), pad(USER), pad(OTHER)], expected: USER },
    { name: 'Withdraw: user at topic2', topics: [TOPIC0.Withdraw, pad(RESERVE), pad(USER), pad(OTHER)], expected: USER },
    { name: 'CollateralEnabled: user at topic2', topics: [TOPIC0.ReserveUsedAsCollateralEnabled, pad(RESERVE), pad(USER)], expected: USER },
    { name: 'CollateralDisabled: user at topic2', topics: [TOPIC0.ReserveUsedAsCollateralDisabled, pad(RESERVE), pad(USER)], expected: USER },
    { name: 'LiquidationCall: user at topic3', topics: [TOPIC0.LiquidationCall, pad(RESERVE), pad(OTHER), pad(USER)], expected: USER },
    { name: 'UserEModeSet: user at topic1', topics: [TOPIC0.UserEModeSet, pad(USER)], expected: USER },
  ]

  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = extractUserFromLog(testCase.topics)
      expect(result?.user).toBe(testCase.expected) // checksummed
      expect(result?.event).toBe((Object.entries(TOPIC0).find(([, t]) => t === testCase.topics[0]) ?? [])[0])
    })
  }

  it('ReserveDataUpdated is not a position event -> null', () => {
    expect(extractUserFromLog([TOPIC0.ReserveDataUpdated, pad(RESERVE)])).toBeNull()
  })
  it('unknown topic0 -> null', () => {
    expect(extractUserFromLog([`0x${'de'.repeat(32)}` as Hex, pad(USER)])).toBeNull()
  })
  it('empty topics -> null', () => {
    expect(extractUserFromLog([])).toBeNull()
  })
  it('truncated topics (user topic missing) -> null', () => {
    expect(extractUserFromLog([TOPIC0.LiquidationCall, pad(RESERVE), pad(OTHER)])).toBeNull()
  })
})
