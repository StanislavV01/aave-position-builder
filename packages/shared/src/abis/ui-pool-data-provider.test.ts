import { describe, expect, it } from 'vitest'
import type { Abi } from 'viem'
import {
  UI_POOL_DATA_PROVIDER_ABI,
  getEModesAbi,
  getReservesDataAbi,
  normalizeEModes,
} from './ui-pool-data-provider'

interface TupleParam {
  type: string
  name?: string
  components?: readonly TupleParam[]
}

function eModeCategoryComponents(abi: Abi): readonly TupleParam[] {
  const fn = abi.find((item) => item.type === 'function' && item.name === 'getEModes')
  if (fn === undefined || fn.type !== 'function') throw new Error('getEModes missing')
  const emodeTuple = (fn.outputs[0] as unknown as TupleParam).components?.[1]
  const components = emodeTuple?.components
  if (components === undefined) throw new Error('unexpected getEModes output shape')
  return components
}

function reservesDataComponents(abi: Abi): readonly TupleParam[] {
  const fn = abi.find((item) => item.type === 'function' && item.name === 'getReservesData')
  if (fn === undefined || fn.type !== 'function') throw new Error('getReservesData missing')
  const reserve = fn.outputs[0] as unknown as TupleParam
  const components = reserve.components
  if (components === undefined) throw new Error('unexpected getReservesData output shape')
  return components
}

describe('getReservesData ABI skew (verified deployed contracts, not aave-v3-origin tags)', () => {
  it('base-sepolia has 42 fields (unbacked + virtualAccActive inserted); base has vanilla 40', () => {
    const sepolia = reservesDataComponents(getReservesDataAbi('base-sepolia'))
    const base = reservesDataComponents(getReservesDataAbi('base'))
    expect(base).toHaveLength(40)
    expect(sepolia).toHaveLength(42)
  })

  it('base-sepolia inserts unbacked right after accruedToTreasury and virtualAccActive right after borrowableInIsolation', () => {
    const sepolia = reservesDataComponents(getReservesDataAbi('base-sepolia'))
    expect(sepolia[30]).toMatchObject({ type: 'uint128', name: 'accruedToTreasury' })
    expect(sepolia[31]).toMatchObject({ type: 'uint128', name: 'unbacked' })
    expect(sepolia[32]).toMatchObject({ type: 'uint128', name: 'isolationModeTotalDebt' })
    expect(sepolia[38]).toMatchObject({ type: 'bool', name: 'borrowableInIsolation' })
    expect(sepolia[39]).toMatchObject({ type: 'bool', name: 'virtualAccActive' })
    expect(sepolia[40]).toMatchObject({ type: 'uint128', name: 'virtualUnderlyingBalance' })
  })

  it('stripping the two extra sepolia fields yields exactly the base layout', () => {
    const sepolia = reservesDataComponents(getReservesDataAbi('base-sepolia'))
    const base = reservesDataComponents(getReservesDataAbi('base'))
    const strip = (params: readonly TupleParam[]) => params.map((p) => ({ type: p.type, name: p.name }))
    const sepoliaMinusExtras = sepolia.filter((_, i) => i !== 31 && i !== 39)
    expect(strip(sepoliaMinusExtras)).toEqual(strip(base))
  })

  it('base last two fields are still virtualUnderlyingBalance/deficit', () => {
    const base = reservesDataComponents(getReservesDataAbi('base'))
    expect(base[38]).toMatchObject({ type: 'uint128', name: 'virtualUnderlyingBalance' })
    expect(base[39]).toMatchObject({ type: 'uint128', name: 'deficit' })
  })

  it('UI_POOL_DATA_PROVIDER_ABI no longer carries getReservesData — per-network fn is the only path', () => {
    const removedFnName: string = 'getReservesData'
    const fn = UI_POOL_DATA_PROVIDER_ABI.find((item) => item.type === 'function' && item.name === removedFnName)
    expect(fn).toBeUndefined()
  })

  it('UI_POOL_DATA_PROVIDER_ABI still carries getUserReservesData and getReservesList (identical on both networks)', () => {
    const names = UI_POOL_DATA_PROVIDER_ABI.filter((item) => item.type === 'function').map((item) =>
      item.type === 'function' ? item.name : undefined,
    )
    expect(names).toContain('getUserReservesData')
    expect(names).toContain('getReservesList')
  })
})

describe('getEModes ABI (verified deployed contracts, not aave-v3-origin tags)', () => {
  it('base has 7 fields (ltvzeroBitmap, no isolated); base-sepolia has 6 (no ltvzeroBitmap, no isolated)', () => {
    const base = eModeCategoryComponents(getEModesAbi('base'))
    const sepolia = eModeCategoryComponents(getEModesAbi('base-sepolia'))
    expect(base).toHaveLength(7)
    expect(sepolia).toHaveLength(6)
    expect(base.some((c) => c.name === 'isolated')).toBe(false)
    expect(sepolia.some((c) => c.name === 'isolated')).toBe(false)
    expect(base.some((c) => c.name === 'ltvzeroBitmap')).toBe(true)
    expect(sepolia.some((c) => c.name === 'ltvzeroBitmap')).toBe(false)
  })

  it('sepolia layout is exactly base minus the trailing ltvzeroBitmap field', () => {
    const base = eModeCategoryComponents(getEModesAbi('base'))
    const sepolia = eModeCategoryComponents(getEModesAbi('base-sepolia'))
    const strip = (params: readonly TupleParam[]) => params.map((p) => ({ type: p.type, name: p.name }))
    expect(strip(base.slice(0, 6))).toEqual(strip(sepolia))
  })
})

describe('normalizeEModes', () => {
  const baseShapeCategory = {
    ltv: 9300,
    liquidationThreshold: 9500,
    liquidationBonus: 10100,
    collateralBitmap: 0b0110n,
    label: 'ETH correlated',
    borrowableBitmap: 0b1010n,
    ltvzeroBitmap: 42n,
  }

  const sepoliaShapeCategory = {
    ltv: 9300,
    liquidationThreshold: 9500,
    liquidationBonus: 10100,
    collateralBitmap: 0b0110n,
    label: 'ETH correlated',
    borrowableBitmap: 0b1010n,
  }

  it('base-shape raw (7 fields, real ltvzeroBitmap) decodes with isolated: false and the real ltvzeroBitmap preserved', () => {
    const raw = [{ id: 1, eMode: baseShapeCategory }]
    expect(normalizeEModes('base', raw)).toEqual([
      {
        id: 1,
        ltvBps: 9300n,
        liquidationThresholdBps: 9500n,
        liquidationBonusBps: 10100n,
        collateralBitmap: 0b0110n,
        borrowableBitmap: 0b1010n,
        ltvzeroBitmap: 42n,
        isolated: false,
        label: 'ETH correlated',
      },
    ])
  })

  it('sepolia-shape raw (6 fields, no ltvzeroBitmap) decodes with ltvzeroBitmap: 0n and isolated: false', () => {
    const raw = [{ id: 2, eMode: sepoliaShapeCategory }]
    expect(normalizeEModes('base-sepolia', raw)).toEqual([
      {
        id: 2,
        ltvBps: 9300n,
        liquidationThresholdBps: 9500n,
        liquidationBonusBps: 10100n,
        collateralBitmap: 0b0110n,
        borrowableBitmap: 0b1010n,
        ltvzeroBitmap: 0n,
        isolated: false,
        label: 'ETH correlated',
      },
    ])
  })

  it('rejects malformed input loudly', () => {
    expect(() => normalizeEModes('base-sepolia', [{ id: 1 }])).toThrow()
    expect(() => normalizeEModes('base-sepolia', 'garbage')).toThrow()
    expect(() =>
      normalizeEModes('base-sepolia', [{ id: 1, eMode: { ...sepoliaShapeCategory, collateralBitmap: 6 } }]),
    ).toThrow() // number, not bigint
  })

  // Silent-corruption regression guard: the whole point of per-network strict schemas
  // is that feeding a network its NEIGHBOR's decoded shape must throw, not silently
  // produce a defaulted/misaligned EModeCategoryInfo.
  describe('cross-network shape mismatch (silent-corruption guard)', () => {
    it('rejects base-shaped data (has ltvzeroBitmap) when decoding as base-sepolia', () => {
      const raw = [{ id: 1, eMode: baseShapeCategory }]
      expect(() => normalizeEModes('base-sepolia', raw)).toThrow()
    })

    it('rejects sepolia-shaped data (missing ltvzeroBitmap) when decoding as base', () => {
      const raw = [{ id: 1, eMode: sepoliaShapeCategory }]
      expect(() => normalizeEModes('base', raw)).toThrow()
    })
  })
})
