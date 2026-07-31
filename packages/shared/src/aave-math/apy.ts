import { SECONDS_PER_YEAR } from './ray'

// APY from a ray APR with per-second compounding:
// (1 + r/1e27/31536000)^31536000 - 1.
// This is the ONLY aave-math function returning `number` — it exists purely for
// display. Never feed its output back into position math.
export function rayRateToApy(rateRay: bigint): number {
  const secondsPerYear = Number(SECONDS_PER_YEAR)
  const ratePerSecond = Number(rateRay) / 1e27 / secondsPerYear
  return (1 + ratePerSecond) ** secondsPerYear - 1
}
