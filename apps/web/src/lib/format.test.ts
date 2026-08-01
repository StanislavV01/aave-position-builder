import { describe, expect, it } from 'vitest'
import {
  formatApy,
  formatHealthFactor,
  formatTokenAmount,
  formatUsd,
  healthFactorTone,
  hfGaugePercent,
  hfWadToNumber,
  numberToHfWad,
  trimAmountText,
} from './format'

const MAX_UINT256 = (1n << 256n) - 1n
const WAD = 10n ** 18n

describe('formatTokenAmount', () => {
  it('truncates to 4 fraction digits and trims trailing zeros', () => {
    expect(formatTokenAmount(1_234_567_890_123_456_789n, 18)).toBe('1.2345')
    expect(formatTokenAmount(1_500_000n, 6)).toBe('1.5')
    expect(formatTokenAmount(1_000_000n, 6)).toBe('1')
    expect(formatTokenAmount(0n, 18)).toBe('0')
  })
  it('groups thousands', () => {
    expect(formatTokenAmount(1_234_567_890_123_456n * 10n ** 6n, 18)).toBe('1,234.5678')
  })
  it('shows a floor hint instead of lying "0" for dust', () => {
    expect(formatTokenAmount(123n, 18)).toBe('<0.0001')
  })
  it('respects maxFrac', () => {
    expect(formatTokenAmount(1_234_567n, 6, 2)).toBe('1.23')
  })
})

describe('formatUsd', () => {
  it('renders base-currency (8 dec) values with 2 truncated decimals', () => {
    expect(formatUsd(123_456_789n)).toBe('$1.23')
    expect(formatUsd(200_000_000_000n)).toBe('$2,000.00')
    expect(formatUsd(0n)).toBe('$0.00')
  })
  it('handles negatives', () => {
    expect(formatUsd(-50_000_000n)).toBe('-$0.50')
  })
})

describe('formatHealthFactor', () => {
  it('max uint256 renders as infinity', () => {
    expect(formatHealthFactor(MAX_UINT256)).toBe('∞')
  })
  it('renders 2 truncated decimals', () => {
    expect(formatHealthFactor(2n * WAD)).toBe('2.00')
    expect(formatHealthFactor(1_099n * 10n ** 15n)).toBe('1.09') // truncation, not rounding
  })
  it('caps absurd values', () => {
    expect(formatHealthFactor(1_001n * WAD)).toBe('>1000')
  })
})

describe('formatApy', () => {
  it('renders percent with 2 decimals', () => {
    expect(formatApy(0.0523)).toBe('5.23%')
    expect(formatApy(0)).toBe('0.00%')
  })
})

describe('healthFactorTone', () => {
  it('green strictly above 2, amber from 1.1 to 2, red below 1.1', () => {
    expect(healthFactorTone(MAX_UINT256)).toBe('good')
    expect(healthFactorTone(2n * WAD + 1n)).toBe('good')
    expect(healthFactorTone(2n * WAD)).toBe('warn')
    expect(healthFactorTone(11n * 10n ** 17n)).toBe('warn')
    expect(healthFactorTone(11n * 10n ** 17n - 1n)).toBe('danger')
  })
})

describe('hf slider conversions', () => {
  it('round-trips at slider resolution (0.01)', () => {
    expect(hfWadToNumber(15n * 10n ** 17n)).toBe(1.5)
    expect(numberToHfWad(1.5)).toBe(1_500_000_000_000_000_000n)
    expect(numberToHfWad(1.05)).toBe(1_050_000_000_000_000_000n)
    expect(hfWadToNumber(numberToHfWad(2.37))).toBe(2.37)
  })
})

describe('hfGaugePercent', () => {
  it('pins the liquidation boundary and below to 0%', () => {
    expect(hfGaugePercent(WAD)).toBe(0)
    expect(hfGaugePercent(WAD / 2n)).toBe(0)
  })

  it('is linear between 1.0 and 3.0', () => {
    expect(hfGaugePercent(2n * WAD)).toBe(50)
    expect(hfGaugePercent(15n * 10n ** 17n)).toBe(25) // 1.5
    expect(hfGaugePercent(11n * 10n ** 17n)).toBe(5) // 1.1 — danger/warn boundary matches the 5% zone
  })

  it('pins 3.0+ and the no-debt infinity to 100%', () => {
    expect(hfGaugePercent(3n * WAD)).toBe(100)
    expect(hfGaugePercent(1000n * WAD)).toBe(100)
    expect(hfGaugePercent(MAX_UINT256)).toBe(100)
  })
})

describe('trimAmountText', () => {
  it('truncates long fraction tails without rounding up', () => {
    expect(trimAmountText('123.456789012345678901')).toBe('123.45678901')
    expect(trimAmountText('0.999999999999999999')).toBe('0.99999999')
  })

  it('leaves short and integer inputs untouched', () => {
    expect(trimAmountText('42')).toBe('42')
    expect(trimAmountText('1.5')).toBe('1.5')
  })

  it('drops a trailing dot and zero tails', () => {
    expect(trimAmountText('7.000000000')).toBe('7')
    expect(trimAmountText('0.000000000')).toBe('0')
  })
})
