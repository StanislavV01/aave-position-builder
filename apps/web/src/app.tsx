import { useMemo, useState } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import type { Address } from 'viem'
import { marketByChainId } from '@app/shared'
import { ConnectCta } from './components/wallet/connect-cta'
import { NetworkSwitcher } from './components/wallet/network-switcher'
import { ThemeToggle } from './components/wallet/theme-toggle'
import { MarketPanel } from './components/market/panel'
import { PositionSummary } from './components/position/summary'
import { OpenPositionForm } from './components/open-position/form'
import { PoolRevisionNote, StatusChip } from './components/position/status-chip'
import { useEModes, useReserveIds, useReservesData, useUserReservesData } from './lib/data/market-queries'
import { buildMarketView, buildPositionView } from './lib/data/derived'
import { useLiveUpdates } from './lib/live/updates'
import { marketPaneState, positionPaneState } from './lib/ui/pane-state'

export function App() {
  const [chainId, setChainId] = useState<number>(baseSepolia.id)
  const [collateralAsset, setCollateralAsset] = useState<Address | null>(null)
  const [borrowAsset, setBorrowAsset] = useState<Address | null>(null)
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const networkKey = marketByChainId(chainId)?.networkKey ?? 'base-sepolia'
  const live = useLiveUpdates(networkKey, address)

  const reserves = useReservesData(chainId, live.pollMs)
  const userReserves = useUserReservesData(chainId, address, live.pollMs)
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

  const marketState = marketPaneState([reserves, reserveIds], market !== null)
  const positionState = positionPaneState(
    isConnected,
    [reserves, reserveIds, userReserves, emodes],
    position !== null,
  )
  const retryMarketData = () => {
    void reserves.refetch()
    void reserveIds.refetch()
    void emodes.refetch()
  }
  const retryPositionData = () => {
    retryMarketData()
    void userReserves.refetch()
  }

  return (
    <div className="layout">
      <header className="topbar">
        <h1>Aave V3 Position Builder</h1>
        <ThemeToggle />
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
          {marketState === 'error' ? (
            <div className="error-card" role="alert">
              Could not load market data.{' '}
              <button type="button" className="ghost" onClick={retryMarketData}>
                Retry
              </button>
            </div>
          ) : marketState === 'loading' ? (
            <p className="muted">Loading reserves…</p>
          ) : market ? (
            <MarketPanel
              assets={market}
              selectedSupply={collateralAsset}
              selectedBorrow={borrowAsset}
              onSelectSupply={setCollateralAsset}
              onSelectBorrow={setBorrowAsset}
            />
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
          {positionState === 'error' ? (
            <div className="error-card" role="alert">
              Could not load your position.{' '}
              <button type="button" className="ghost" onClick={retryPositionData}>
                Retry
              </button>
            </div>
          ) : (
            <PositionSummary view={position} isLoading={positionState === 'loading'} />
          )}
        </section>
      </main>
      <footer className="statusbar">
        <StatusChip status={live.status} lastEventAtMs={live.lastEventAtMs} />
        <PoolRevisionNote chainId={chainId} />
      </footer>
    </div>
  )
}
