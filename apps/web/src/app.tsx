import { useState } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { ConnectCta } from './components/connect-cta'
import { NetworkSwitcher } from './components/network-switcher'

export function App() {
  const [chainId, setChainId] = useState<number>(baseSepolia.id)
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()

  return (
    <div className="layout">
      <header className="topbar">
        <h1>Aave V3 Position Builder</h1>
        <NetworkSwitcher chainId={chainId} onChange={setChainId} />
        {isConnected && address ? (
          <span className="account tabular">
            {address.slice(0, 6)}…{address.slice(-4)}
            <button className="ghost" onClick={() => disconnect()}>
              Disconnect
            </button>
          </span>
        ) : null}
      </header>
      <main className="panes">
        <section className="card">
          <h2>Market</h2>
          <p className="muted">Reserve data lands in the next task.</p>
        </section>
        <section className="card">
          <h2>Open a position</h2>
          <ConnectCta requiredChainId={chainId}>
            <p className="muted">Position form lands in a later task.</p>
          </ConnectCta>
        </section>
        <section className="card">
          <h2>Your position</h2>
          <p className="muted">Position summary lands in a later task.</p>
        </section>
      </main>
      <footer className="statusbar">
        <span className="muted">live status lands in a later task</span>
      </footer>
    </div>
  )
}
