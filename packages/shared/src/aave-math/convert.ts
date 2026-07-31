// Token amount <-> base-currency (USD, 8 decimals on Base/Base Sepolia) conversion.
// Both directions FLOOR, matching how Aave computes user balances in base currency
// (never credit the user with value that rounding invented).

export function toBaseCurrency(amount: bigint, decimals: number, priceInBase: bigint): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`toBaseCurrency: invalid decimals: ${decimals}`)
  }
  return (amount * priceInBase) / 10n ** BigInt(decimals)
}

export function fromBaseCurrency(baseAmount: bigint, decimals: number, priceInBase: bigint): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`fromBaseCurrency: invalid decimals: ${decimals}`)
  }
  if (priceInBase === 0n) throw new Error('fromBaseCurrency: price is zero')
  return (baseAmount * 10n ** BigInt(decimals)) / priceInBase
}
