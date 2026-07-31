import { describe, expect, it } from 'vitest'
import { MARKETS, isNetworkKey, marketByChainId, marketByNetworkKey } from './networks'

describe('MARKETS (drift detection against pinned @bgd-labs/aave-address-book 4.44.22)', () => {
  it('has exactly two markets in order base, base-sepolia', () => {
    expect(MARKETS).toHaveLength(2)
    expect(MARKETS.map((m) => m.networkKey)).toEqual(['base', 'base-sepolia'])
  })

  it('Base mainnet config matches the verified on-chain table', () => {
    const base = marketByNetworkKey('base')
    expect(base.chainId).toBe(8453)
    expect(base.chainName).toBe('Base')
    expect(base.pool).toBe('0xA238Dd80C259a72e81d7e4664a9801593F98d1c5')
    expect(base.poolAddressesProvider).toBe('0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D')
    expect(base.uiPoolDataProvider).toBe('0xb84A20e848baE3e13897934bB4e74E2225f4546B')
    expect(base.oracle).toBe('0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156')
    expect(base.faucet).toBeNull()
    expect(base.expectedPoolRevision).toBe(11n)
    expect(base.protocolVersion).toBe('v3.7')
  })

  it('Base Sepolia config matches the verified on-chain table', () => {
    const sepolia = marketByNetworkKey('base-sepolia')
    expect(sepolia.chainId).toBe(84532)
    expect(sepolia.chainName).toBe('Base Sepolia')
    expect(sepolia.pool).toBe('0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27')
    expect(sepolia.poolAddressesProvider).toBe('0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00')
    expect(sepolia.uiPoolDataProvider).toBe('0x6a9D64f93DB660EaCB2b6E9424792c630CdA87d8')
    expect(sepolia.oracle).toBe('0x943b0dE18d4abf4eF02A85912F8fc07684C141dF')
    expect(sepolia.faucet).toBe('0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc')
    expect(sepolia.expectedPoolRevision).toBe(10n)
    expect(sepolia.protocolVersion).toBe('v3.6')
  })

  it('lookup helpers behave', () => {
    expect(marketByChainId(8453)?.networkKey).toBe('base')
    expect(marketByChainId(84532)?.networkKey).toBe('base-sepolia')
    expect(marketByChainId(1)).toBeUndefined()
    expect(isNetworkKey('base')).toBe(true)
    expect(isNetworkKey('base-sepolia')).toBe(true)
    expect(isNetworkKey('ethereum')).toBe(false)
    expect(isNetworkKey('')).toBe(false)
    expect(() => marketByNetworkKey('nope' as never)).toThrow(/unknown network/i)
  })
})
