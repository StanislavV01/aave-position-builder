import { useQuery } from '@tanstack/react-query'
import { useConfig, type Config } from 'wagmi'
import { multicall, readContract } from 'wagmi/actions'
import { encodeAbiParameters, keccak256, parseAbiParameters, toBytes, type Address } from 'viem'
import { ERC20_ABI, marketByChainId } from '@app/shared'

export interface TokenState {
  balance: bigint
  allowance: bigint
}

export function useTokenState(chainId: number, owner: Address | undefined, asset: Address | undefined) {
  const config = useConfig()
  const market = marketByChainId(chainId)
  return useQuery({
    queryKey: ['tokenState', chainId, owner, asset],
    staleTime: 10_000,
    enabled: market !== undefined && owner !== undefined && asset !== undefined,
    queryFn: async (): Promise<TokenState> => {
      if (!market || !owner || !asset) throw new Error('query disabled')
      const [balance, allowance] = (await multicall(config, {
        chainId: market.chainId,
        allowFailure: false,
        contracts: [
          { address: asset, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] },
          { address: asset, abi: ERC20_ABI, functionName: 'allowance', args: [owner, market.pool] },
        ],
      })) as unknown as readonly [bigint, bigint]
      return { balance, allowance }
    },
  })
}

export type PermitSupport =
  | { supported: false }
  | { supported: true; version: '1' | '2'; name: string }

const WETH_ADDRESS = '0x4200000000000000000000000000000000000006'

const EIP712_DOMAIN_TYPEHASH = keccak256(
  toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
)

/** Probe address for nonces() — any address works, we only care that the call succeeds. */
const PROBE = '0x0000000000000000000000000000000000000001'

export async function detectPermitSupport(
  config: Config,
  chainId: 8453 | 84532,
  asset: Address,
): Promise<PermitSupport> {
  if (asset.toLowerCase() === WETH_ADDRESS) return { supported: false }
  try {
    const [onChainSeparator, name] = await Promise.all([
      readContract(config, { chainId, address: asset, abi: ERC20_ABI, functionName: 'DOMAIN_SEPARATOR' }) as Promise<`0x${string}`>,
      readContract(config, { chainId, address: asset, abi: ERC20_ABI, functionName: 'name' }) as Promise<string>,
      // nonces() must also exist for permit to be usable at all:
      readContract(config, { chainId, address: asset, abi: ERC20_ABI, functionName: 'nonces', args: [PROBE] }),
    ])
    for (const version of ['1', '2'] as const) {
      const computed = keccak256(
        encodeAbiParameters(parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'), [
          EIP712_DOMAIN_TYPEHASH,
          keccak256(toBytes(name)),
          keccak256(toBytes(version)),
          BigInt(chainId),
          asset,
        ]),
      )
      if (computed.toLowerCase() === onChainSeparator.toLowerCase()) {
        return { supported: true, version, name }
      }
    }
    // Token has a DOMAIN_SEPARATOR but a layout we did not reproduce (salt, odd
    // version string, …) — a wrong guess means a reverting permit, so fall back.
    return { supported: false }
  } catch {
    // any of the three calls reverting == not an EIP-2612 token
    return { supported: false }
  }
}

export function usePermitSupport(chainId: number, asset: Address | undefined) {
  const config = useConfig()
  const market = marketByChainId(chainId)
  return useQuery({
    queryKey: ['permitSupport', chainId, asset],
    staleTime: Infinity,
    enabled: market !== undefined && asset !== undefined,
    queryFn: (): Promise<PermitSupport> => {
      if (!market || !asset) throw new Error('query disabled')
      return detectPermitSupport(config, market.chainId, asset)
    },
  })
}
