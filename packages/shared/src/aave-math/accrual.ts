// bigint port of MathUtils (aave-v3-origin v3.6.0). Indexes reported by
// UiPoolDataProvider are as-of lastUpdateTimestamp; these functions roll them
// forward so displayed balances/debt match what the chain would compute now.
import { RAY, SECONDS_PER_YEAR, rayMul } from './ray'

export function calculateLinearInterest(
  rateRay: bigint,
  lastUpdateTimestamp: bigint,
  nowTimestamp: bigint,
): bigint {
  return RAY + (rateRay * (nowTimestamp - lastUpdateTimestamp)) / SECONDS_PER_YEAR
}

// (1+x)^n approximated as 1 + n*x + n(n-1)/2*x^2 + n(n-1)(n-2)/6*x^3 — verbatim
// port of MathUtils.calculateCompoundedInterest, including its truncating
// intermediate divisions (x/2, x/6). Slightly underestimates true compounding,
// exactly like the chain does.
export function calculateCompoundedInterest(
  rateRay: bigint,
  lastUpdateTimestamp: bigint,
  nowTimestamp: bigint,
): bigint {
  const exp = nowTimestamp - lastUpdateTimestamp
  if (exp === 0n) return RAY
  const x = (rateRay * exp) / SECONDS_PER_YEAR
  return RAY + x + rayMul(x, x / 2n + rayMul(x, x / 6n))
}

export function getATokenBalance(scaled: bigint, liquidityIndexRay: bigint): bigint {
  return rayMul(scaled, liquidityIndexRay)
}

export function getVTokenBalance(scaledDebt: bigint, variableBorrowIndexRay: bigint): bigint {
  return rayMul(scaledDebt, variableBorrowIndexRay)
}
