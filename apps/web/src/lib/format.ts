const MAX_UINT256 = (1n << 256n) - 1n
const WAD = 10n ** 18n

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Truncating token formatter. The ONLY place money bigints become strings. */
export function formatTokenAmount(amount: bigint, decimals: number, maxFrac = 4): string {
  const neg = amount < 0n
  const abs = neg ? -amount : amount
  const unit = 10n ** BigInt(decimals)
  const whole = abs / unit
  const frac = abs % unit
  const fracDigits = frac.toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '')
  if (whole === 0n && fracDigits === '' && frac > 0n) {
    return `<0.${'0'.repeat(Math.max(maxFrac - 1, 0))}1`
  }
  const body = fracDigits === '' ? groupThousands(whole.toString()) : `${groupThousands(whole.toString())}.${fracDigits}`
  return neg ? `-${body}` : body
}

/** Base-currency values are USD with 8 decimals on both Aave Base markets. */
export function formatUsd(base8: bigint): string {
  const neg = base8 < 0n
  const abs = neg ? -base8 : base8
  const whole = abs / 100_000_000n
  const cents = (abs % 100_000_000n) / 1_000_000n
  const body = `$${groupThousands(whole.toString())}.${cents.toString().padStart(2, '0')}`
  return neg ? `-${body}` : body
}

export function formatHealthFactor(hfWad: bigint): string {
  if (hfWad === MAX_UINT256) return '∞'
  if (hfWad > 1000n * WAD) return '>1000'
  const whole = hfWad / WAD
  const frac = ((hfWad % WAD) / 10n ** 16n).toString().padStart(2, '0')
  return `${whole}.${frac}`
}

export function formatApy(apy: number): string {
  return `${(apy * 100).toFixed(2)}%`
}

export function healthFactorTone(hfWad: bigint): 'good' | 'warn' | 'danger' {
  if (hfWad > 2n * WAD) return 'good'
  if (hfWad >= 11n * 10n ** 17n) return 'warn'
  return 'danger'
}

/**
 * Position of an HF value on the gauge track: linear from 1.0 (liquidation, 0%)
 * to 3.0 (100%); ∞ and anything above 3.0 pin to 100. Matches the HfSlider range,
 * so the gauge and the slider tell one consistent spatial story.
 */
export function hfGaugePercent(hfWad: bigint): number {
  const min = WAD
  const max = 3n * WAD
  if (hfWad <= min) return 0
  if (hfWad >= max) return 100
  return Number(((hfWad - min) * 10_000n) / (max - min)) / 100
}

/**
 * Trim a decimal string for display in an editable field (e.g. the auto-sized borrow
 * amount, which formatUnits renders with up to 18 fraction digits). Truncates — never
 * rounds up — so the shown value is always executable.
 */
export function trimAmountText(text: string, maxFrac = 8): string {
  const dot = text.indexOf('.')
  if (dot === -1) return text
  const trimmed = text.slice(0, dot + 1 + maxFrac).replace(/\.?0+$/, '')
  return trimmed === '' ? '0' : trimmed
}

/** Slider edge conversions — resolution 0.01, safe well inside double precision. */
export function hfWadToNumber(hfWad: bigint): number {
  return Number(hfWad / 10n ** 16n) / 100
}

export function numberToHfWad(n: number): bigint {
  return BigInt(Math.round(n * 100)) * 10n ** 16n
}
