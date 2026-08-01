import { useMemo, useState } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import type { Address } from 'viem'
import { ConnectCta } from './components/connect-cta'
import { NetworkSwitcher } from './components/network-switcher'
import { MarketPanel } from './components/market-panel'
import { PositionSummary } from './components/position-summary'
import { OpenPositionForm } from './components/open-position-form'
import { PoolRevisionNote, StatusChip } from './components/status-chip'
import { useEModes, useReserveIds, useReservesData, useUserReservesData } from './lib/market-queries'
import { buildMarketView, buildPositionView } from './lib/derived'

export function App() {
  const [chainId, setChainId] = useState<number>(baseSepolia.id)
  const [collateralAsset, setCollateralAsset] = useState<Address | null>(null)
  const [borrowAsset, setBorrowAsset] = useState<Address | null>(null)
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()

  const reserves = useReservesData(chainId)
  const userReserves = useUserReservesData(chainId, address)
  const emodes = useEModes(chainId)
  const reserveIds = useReserveIds(chainId)

  const market = useMemo(() => {
    if (!reserves.data || !reserveIds.data) return null
    return buildMarketView(reserves.data.reserves, reserves.data.baseCurrency, reserveIds.data)
  }, [reserves.data, reserveIds.data])

  const position = useMemo(() => {
    if (!market || !reserves.data || !userReserves.data || !emodes.data) return null
    return buildPositionView(
      market,
      userReserves.data.userReserves,
      userReserves.data.userEModeCategoryId,
      emodes.data,
      reserves.data.baseCurrency,
    )
  }, [market, reserves.data, userReserves.data, emodes.data])

  const handleNetworkChange = (next: number) => {
    setChainId(next)
    setCollateralAsset(null)
    setBorrowAsset(null)
  }

  return (
    <div className="layout">
      <header className="topbar">
        <h1>Aave V3 Position Builder</h1>
        <NetworkSwitcher chainId={chainId} onChange={handleNetworkChange} />
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
          {reserves.isError ? (
            <div className="error-card">
              Could not load market data.{' '}
              <button className="ghost" onClick={() => void reserves.refetch()}>
                Retry
              </button>
            </div>
          ) : null}
          {market ? (
            <MarketPanel
              assets={market}
              selectedSupply={collateralAsset}
              selectedBorrow={borrowAsset}
              onSelectSupply={setCollateralAsset}
              onSelectBorrow={setBorrowAsset}
            />
          ) : reserves.isPending || reserveIds.isPending ? (
            <p className="muted">Loading reserves…</p>
          ) : null}
        </section>
        <section className="card">
          <h2>Open a position</h2>
          <ConnectCta requiredChainId={chainId}>
            {collateralAsset && borrowAsset ? (
              <OpenPositionForm chainId={chainId} collateralAsset={collateralAsset} borrowAsset={borrowAsset} />
            ) : (
              <p className="muted">Pick a collateral asset and a borrow asset in the market panel.</p>
            )}
          </ConnectCta>
        </section>
        <section className="card">
          <h2>Your position</h2>
          <PositionSummary
            view={isConnected ? position : null}
            isLoading={isConnected && (userReserves.isPending || !market || emodes.isPending)}
          />
        </section>
      </main>
      <footer className="statusbar">
        <StatusChip status="degraded" lastEventAtMs={null} />
        <PoolRevisionNote chainId={chainId} />
      </footer>
    </div>
  )
}
