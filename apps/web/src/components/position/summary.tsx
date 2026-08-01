import type { PositionView } from '../../lib/data/derived'
import { formatApy, formatTokenAmount, formatUsd } from '../../lib/format'
import { HfGauge } from './hf-gauge'

export function PositionSummary({ view, isLoading }: { view: PositionView | null; isLoading: boolean }) {
  if (isLoading) return <p className="muted">Loading position…</p>
  if (!view) return <p className="muted">Connect a wallet to see your position.</p>
  if (view.supplied.length === 0 && view.borrowed.length === 0) {
    return (
      <div className="empty-state">
        <p>No position on this network yet.</p>
        <p>Pick a collateral and a borrow asset on the left — the target-HF slider sizes the borrow for you.</p>
      </div>
    )
  }
  return (
    <div>
      <HfGauge hfWad={view.account.healthFactorWad} />
      {view.eModeCategoryId !== 0 || view.account.hasZeroLtvCollateral ? (
        <p>
          {view.eModeCategoryId !== 0 ? (
            <span className="badge">eMode: {view.eModeLabel ?? view.eModeCategoryId}</span>
          ) : null}{' '}
          {view.account.hasZeroLtvCollateral ? (
            <span className="badge">some collateral has zero borrowing power</span>
          ) : null}
        </p>
      ) : null}
      {view.supplied.length > 0 ? (
        <>
          <h3 className="muted">Supplied</h3>
          <ul className="asset-list">
            {view.supplied.map((s) => (
              <li key={s.asset.asset} className="asset-row">
                <strong>{s.asset.symbol}</strong>
                <span className="tabular">{formatTokenAmount(s.balance, s.asset.decimals)}</span>
                <span className="muted tabular">{formatUsd(s.balanceBase)}</span>
                <span className="apy tabular">{formatApy(s.asset.supplyApy)}</span>
                {!s.isCollateral ? <span className="badge">not collateral</span> : null}
                {s.isCollateral && s.asset.ltvBps === 0n ? <span className="badge">zero LTV</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {view.borrowed.length > 0 ? (
        <>
          <h3 className="muted">Borrowed</h3>
          <ul className="asset-list">
            {view.borrowed.map((b) => (
              <li key={b.asset.asset} className="asset-row">
                <strong>{b.asset.symbol}</strong>
                <span className="tabular">{formatTokenAmount(b.debt, b.asset.decimals)}</span>
                <span className="muted tabular">{formatUsd(b.debtBase)}</span>
                <span className="apy tabular">{formatApy(b.asset.borrowApy)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="muted tabular">
        Collateral {formatUsd(view.account.totalCollateralBase)} · Debt {formatUsd(view.account.totalDebtBase)} · Can
        still borrow {formatUsd(view.account.availableBorrowsBase)}
      </p>
    </div>
  )
}
