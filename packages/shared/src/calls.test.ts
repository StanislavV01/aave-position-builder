import { describe, expect, it } from 'vitest'
import { decodeFunctionData } from 'viem'
import type { Hex } from 'viem'
import { POOL_ABI } from './abis/pool'
import { marketByNetworkKey } from './networks'
import { buildOpenPositionCalls } from './calls'
import type { OpenPositionArgs } from './calls'

const market = marketByNetworkKey('base-sepolia')
const USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const
const WETH = '0x4200000000000000000000000000000000000006' as const // collateral
const USDC = '0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f' as const // borrow (Base Sepolia USDC)
const COLLATERAL_AMOUNT = 2n * 10n ** 18n
const BORROW_AMOUNT = 4_100n * 10n ** 6n

const baseArgs: OpenPositionArgs = {
  market,
  user: USER,
  collateralAsset: WETH,
  collateralAmount: COLLATERAL_AMOUNT,
  borrowAsset: USDC,
  borrowAmount: BORROW_AMOUNT,
  eModeCategoryToSet: null,
  permit: null,
}

const PERMIT = {
  deadline: 1_785_600_000n,
  v: 27,
  r: `0x${'11'.repeat(32)}` as Hex,
  s: `0x${'22'.repeat(32)}` as Hex,
}

describe('buildOpenPositionCalls', () => {
  it('permit path -> [supplyWithPermit, borrow] with correct selectors and args', () => {
    const { calls, steps } = buildOpenPositionCalls({ ...baseArgs, permit: PERMIT })
    expect(steps.map((s) => s.kind)).toEqual(['supplyWithPermit', 'borrow'])
    expect(calls).toEqual(steps.map((s) => s.data))
    expect(calls[0]?.slice(0, 10)).toBe('0x02c205f0')
    expect(calls[1]?.slice(0, 10)).toBe('0xa415bcad')

    const supplyCall = decodeFunctionData({ abi: POOL_ABI, data: calls[0] as Hex })
    expect(supplyCall.functionName).toBe('supplyWithPermit')
    expect(supplyCall.args).toEqual([WETH, COLLATERAL_AMOUNT, USER, 0, PERMIT.deadline, 27, PERMIT.r, PERMIT.s])

    const borrowCall = decodeFunctionData({ abi: POOL_ABI, data: calls[1] as Hex })
    expect(borrowCall.functionName).toBe('borrow')
    expect(borrowCall.args).toEqual([USDC, BORROW_AMOUNT, 2n, 0, USER]) // rate mode ALWAYS variable (2), referral 0
  })

  it('approve path -> [supply, borrow]', () => {
    const { calls, steps } = buildOpenPositionCalls(baseArgs)
    expect(steps.map((s) => s.kind)).toEqual(['supply', 'borrow'])
    expect(calls[0]?.slice(0, 10)).toBe('0x617ba037')
    const supplyCall = decodeFunctionData({ abi: POOL_ABI, data: calls[0] as Hex })
    expect(supplyCall.functionName).toBe('supply')
    expect(supplyCall.args).toEqual([WETH, COLLATERAL_AMOUNT, USER, 0])
  })

  it('eMode is inserted between supply and borrow', () => {
    const { calls, steps } = buildOpenPositionCalls({ ...baseArgs, eModeCategoryToSet: 1 })
    expect(steps.map((s) => s.kind)).toEqual(['supply', 'setUserEMode', 'borrow'])
    expect(calls[1]?.slice(0, 10)).toBe('0x28530a47')
    const eModeCall = decodeFunctionData({ abi: POOL_ABI, data: calls[1] as Hex })
    expect(eModeCall.functionName).toBe('setUserEMode')
    expect(eModeCall.args).toEqual([1])
  })

  it('permit + eMode -> [supplyWithPermit, setUserEMode, borrow]', () => {
    const { steps } = buildOpenPositionCalls({ ...baseArgs, permit: PERMIT, eModeCategoryToSet: 2 })
    expect(steps.map((s) => s.kind)).toEqual(['supplyWithPermit', 'setUserEMode', 'borrow'])
  })

  it('eModeCategoryToSet null means the eMode call is absent (never setUserEMode(0))', () => {
    const { steps } = buildOpenPositionCalls(baseArgs)
    expect(steps.some((s) => s.kind === 'setUserEMode')).toBe(false)
  })

  it('rejects zero amounts', () => {
    expect(() => buildOpenPositionCalls({ ...baseArgs, collateralAmount: 0n })).toThrow()
    expect(() => buildOpenPositionCalls({ ...baseArgs, borrowAmount: 0n })).toThrow()
  })
})
