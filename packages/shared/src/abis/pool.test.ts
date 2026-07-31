import { describe, expect, it } from 'vitest'
import { toEventSelector, toFunctionSelector } from 'viem'
import type { AbiEvent, AbiFunction } from 'viem'
import { POOL_ABI, POOL_EVENT_DEFS } from './pool'

const EXPECTED_TOPIC0: Record<string, `0x${string}`> = {
  Supply: '0x2b627736bca15cd5381dcf80b0bf11fd197d01a037c52b927a881a10fb73ba61',
  Borrow: '0xb3d084820fb1a9decffb176436bd02558d15fac9b0ddfed8c465bc7359d7dce0',
  Repay: '0xa534c8dbe71f871f9f3530e97a74601fea17b426cae02e1c5aee42c96c784051',
  Withdraw: '0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7',
  LiquidationCall: '0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286',
  ReserveUsedAsCollateralEnabled: '0x00058a56ea94653cdf4f152d227ace22d4c00ad99e2a43f58cb7d9e3feb295f2',
  ReserveUsedAsCollateralDisabled: '0x44c58d81365b66dd4b1a7f36c25aa97b8c71c361ee4937adc1a00000227db5dd',
  UserEModeSet: '0xd728da875fc88944cbf17638bcbe4af0eedaef63becd1d1c57cc097eb4608d84',
  ReserveDataUpdated: '0x804c9b842b2748a22bb64b345453a3de7ca54a6ca45ce00d415894979e22897a',
}

describe('POOL_ABI', () => {
  it('defines all 9 events and their topic0 hashes are stable', () => {
    const events = POOL_ABI.filter((item): item is Extract<(typeof POOL_ABI)[number], { type: 'event' }> => item.type === 'event')
    expect(events.map((e) => e.name).sort()).toEqual(Object.keys(EXPECTED_TOPIC0).sort())
    for (const event of events) {
      expect(toEventSelector(event as AbiEvent), event.name).toBe(EXPECTED_TOPIC0[event.name])
    }
  })

  it('POOL_EVENT_DEFS contains exactly the event items', () => {
    expect(POOL_EVENT_DEFS).toHaveLength(9)
    expect(POOL_EVENT_DEFS.every((e) => e.type === 'event')).toBe(true)
  })

  it('Borrow hashes interestRateMode as uint8 (enum), not uint256', () => {
    const wrong = toEventSelector('event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint256 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)')
    expect(wrong).not.toBe(EXPECTED_TOPIC0['Borrow'])
  })

  it('function selectors are stable', () => {
    const selectorOf = (name: string): `0x${string}` => {
      const fn = POOL_ABI.find((item): item is Extract<(typeof POOL_ABI)[number], { type: 'function' }> => item.type === 'function' && item.name === name)
      if (fn === undefined) throw new Error(`missing function ${name}`)
      return toFunctionSelector(fn as AbiFunction)
    }
    expect(selectorOf('supply')).toBe('0x617ba037')
    expect(selectorOf('supplyWithPermit')).toBe('0x02c205f0')
    expect(selectorOf('borrow')).toBe('0xa415bcad')
    expect(selectorOf('setUserEMode')).toBe('0x28530a47')
    expect(selectorOf('multicall')).toBe('0xac9650d8')
    expect(selectorOf('POOL_REVISION')).toBe('0x0148170e')
    expect(selectorOf('getReserveAddressById')).toBe('0x52751797')
    expect(selectorOf('getUserAccountData')).toBe('0xbf92857c')
  })
})
