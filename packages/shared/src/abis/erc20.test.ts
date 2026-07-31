import { describe, expect, it } from 'vitest'
import { toFunctionSelector } from 'viem'
import type { AbiFunction } from 'viem'
import { ERC20_ABI } from './erc20'
import { FAUCET_ABI } from './faucet'

function selectorOf(abi: readonly unknown[], name: string): `0x${string}` {
  const fn = (abi as readonly { type: string; name?: string }[]).find(
    (item) => item.type === 'function' && item.name === name,
  )
  if (fn === undefined) throw new Error(`missing function ${name}`)
  return toFunctionSelector(fn as unknown as AbiFunction)
}

describe('ERC20_ABI incl. EIP-2612', () => {
  it('has stable selectors for the calls we make', () => {
    expect(selectorOf(ERC20_ABI, 'balanceOf')).toBe('0x70a08231')
    expect(selectorOf(ERC20_ABI, 'approve')).toBe('0x095ea7b3')
    expect(selectorOf(ERC20_ABI, 'nonces')).toBe('0x7ecebe00')
    expect(selectorOf(ERC20_ABI, 'DOMAIN_SEPARATOR')).toBe('0x3644e515')
    expect(selectorOf(ERC20_ABI, 'permit')).toBe('0xd505accf')
    expect(selectorOf(ERC20_ABI, 'eip712Domain')).toBe('0x84b0196e')
  })
})

describe('FAUCET_ABI', () => {
  it('mint(address token, address to, uint256 amount) selector is stable', () => {
    expect(selectorOf(FAUCET_ABI, 'mint')).toBe('0xc6c3bbe6')
  })
})
