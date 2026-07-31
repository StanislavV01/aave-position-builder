import { describe, expect, it } from 'vitest'
import type { Abi } from 'viem'
import { UI_POOL_DATA_PROVIDER_ABI, getEModesAbi, normalizeEModes } from './ui-pool-data-provider'

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

describe('getEModes ABI skew (v3.6 vs v3.7)', () => {
  it('v3.7 (base) has 8 fields with bool isolated inserted at position 5; v3.6 (base-sepolia) has 7', () => {
    const v36 = eModeCategoryComponents(getEModesAbi('base-sepolia'))
    const v37 = eModeCategoryComponents(getEModesAbi('base'))
    expect(v36).toHaveLength(7)
    expect(v37).toHaveLength(8)
    expect(v37[4]).toMatchObject({ type: 'bool', name: 'isolated' })
    // Removing `isolated` from v3.7 must yield EXACTLY the v3.6 layout — nothing else differs.
    const strip = (params: readonly TupleParam[]) => params.map((p) => ({ type: p.type, name: p.name }))
    expect(strip(v37.filter((_, i) => i !== 4))).toEqual(strip(v36))
  })

  it('shared ABI: getReservesData returns the 40-field AggregatedReserveData tuple', () => {
    const fn = UI_POOL_DATA_PROVIDER_ABI.find((item) => item.type === 'function' && item.name === 'getReservesData')
    if (fn === undefined || fn.type !== 'function') throw new Error('getReservesData missing')
    expect(fn.outputs).toHaveLength(2)
    const reserve = fn.outputs[0] as unknown as TupleParam
    expect(reserve.type).toBe('tuple[]')
    expect(reserve.components).toHaveLength(40)
    expect(reserve.components?.[0]?.name).toBe('underlyingAsset')
    expect(reserve.components?.[38]?.name).toBe('virtualUnderlyingBalance')
    expect(reserve.components?.[39]?.name).toBe('deficit')
  })
})

describe('normalizeEModes', () => {
  const sharedCategory = {
    ltv: 9300,
    liquidationThreshold: 9500,
    liquidationBonus: 10100,
    collateralBitmap: 0b0110n,
    label: 'ETH correlated',
    borrowableBitmap: 0b1010n,
    ltvzeroBitmap: 0n,
  }

  it('decodes v3.6 raw (no isolated field) with isolated defaulted to false', () => {
    const raw = [{ id: 1, eMode: sharedCategory }]
    expect(normalizeEModes('base-sepolia', raw)).toEqual([
      {
        id: 1,
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

  it('decodes v3.7 raw preserving isolated', () => {
    const raw = [{ id: 2, eMode: { ...sharedCategory, isolated: true } }]
    const result = normalizeEModes('base', raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(2)
    expect(result[0]?.isolated).toBe(true)
  })

  it('rejects malformed input loudly', () => {
    expect(() => normalizeEModes('base', [{ id: 1, eMode: sharedCategory }])).toThrow() // missing isolated on v3.7
    expect(() => normalizeEModes('base-sepolia', [{ id: 1 }])).toThrow()
    expect(() => normalizeEModes('base-sepolia', 'garbage')).toThrow()
    expect(() => normalizeEModes('base-sepolia', [{ id: 1, eMode: { ...sharedCategory, collateralBitmap: 6 } }])).toThrow() // number, not bigint
  })
})
