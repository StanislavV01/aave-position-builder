import type { ReactNode } from 'react'
import { useAccount, useConnect, useSwitchChain } from 'wagmi'
import { base, baseSepolia } from 'wagmi/chains'
import { marketByChainId } from '@app/shared'

type ConfiguredChainId = typeof base.id | typeof baseSepolia.id

export function ConnectCta({ requiredChainId, children }: { requiredChainId: number; children: ReactNode }) {
  const { isConnected, chainId } = useAccount()
  const { connect, connectors, isPending: connecting, error: connectError } = useConnect()
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain()

  if (!isConnected) {
    const connector = connectors[0]
    return (
      <div>
        <button
          className="cta"
          disabled={connecting || !connector}
          onClick={() => connector && connect({ connector })}
        >
          {connecting ? 'Connecting…' : connector ? 'Connect wallet' : 'No injected wallet found'}
        </button>
        {connectError ? (
          <div className="error-card" role="alert">
            {connectError.message}
          </div>
        ) : null}
      </div>
    )
  }

  if (chainId !== requiredChainId) {
    const target = marketByChainId(requiredChainId)
    return (
      <div>
        <button
          className="cta"
          disabled={switching}
          onClick={() => switchChain({ chainId: requiredChainId as ConfiguredChainId })}
        >
          {switching ? 'Switching…' : `Switch to ${target?.chainName ?? `chain ${requiredChainId}`}`}
        </button>
        {switchError ? (
          <div className="error-card" role="alert">
            Switch failed or timed out — switch networks manually in your wallet, the app will follow.
          </div>
        ) : null}
      </div>
    )
  }

  return <>{children}</>
}
