// bigint port of Aave's WadRayMath + PercentageMath (aave-v3-origin v3.6.0).
// Default operations round HALF UP, exactly like the Solidity assembly:
//   mul: (a*b + HALF_UNIT) / UNIT      div: (a*UNIT + b/2) / b
// Inputs are always non-negative in Aave; behavior for negatives is unspecified.

export const RAY = 10n ** 27n
export const HALF_RAY = RAY / 2n
export const WAD = 10n ** 18n
export const HALF_WAD = WAD / 2n
export const PERCENTAGE_FACTOR = 10_000n
export const HALF_PERCENTAGE_FACTOR = 5_000n
export const SECONDS_PER_YEAR = 31_536_000n // 365 days, ignoring leap years (MathUtils)

export function rayMul(a: bigint, b: bigint): bigint {
  return (a * b + HALF_RAY) / RAY
}

export function rayDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error('rayDiv: division by zero')
  return (a * RAY + b / 2n) / b
}

export function wadDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error('wadDiv: division by zero')
  return (a * WAD + b / 2n) / b
}

export function percentMul(value: bigint, bps: bigint): bigint {
  return (value * bps + HALF_PERCENTAGE_FACTOR) / PERCENTAGE_FACTOR
}

export function percentMulFloor(value: bigint, bps: bigint): bigint {
  return (value * bps) / PERCENTAGE_FACTOR
}

export function percentDiv(value: bigint, bps: bigint): bigint {
  if (bps === 0n) throw new Error('percentDiv: division by zero')
  return (value * PERCENTAGE_FACTOR + bps / 2n) / bps
}

export function percentDivCeil(value: bigint, bps: bigint): bigint {
  if (bps === 0n) throw new Error('percentDivCeil: division by zero')
  return (value * PERCENTAGE_FACTOR + bps - 1n) / bps
}
