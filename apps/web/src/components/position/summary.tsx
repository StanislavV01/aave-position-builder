import type { PositionView } from '../../lib/data/derived'
import { formatApy, formatTokenAmount, formatUsd } from '../../lib/format'
import { HfGauge } from './hf-gauge'
import { TokenIcon } from '../shared/token-icon'
import { SkeletonLines } from '../shared/skeleton'

export function PositionSummary({ view, isLoading }: { view: PositionView | null; isLoading: boolean }) {
  if (isLoading) return <SkeletonLines lines={5} label="Loading position" />
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
          <h3 id="supplied-heading">Supplied</h3>
          <table className="position-table" aria-labelledby="supplied-heading">
            <thead className="visually-hidden">
              <tr>
                <th scope="col">Asset</th>
                <th scope="col">Balance</th>
                <th scope="col">Value</th>
                <th scope="col">Supply APY</th>
              </tr>
            </thead>
            <tbody>
              {view.supplied.map((s) => (
                <tr key={s.asset.asset}>
                  <td>
                    <span className="position-asset">
                      <TokenIcon symbol={s.asset.symbol} />
                      <strong>{s.asset.symbol}</strong>
                      {!s.isCollateral ? <span className="badge">not collateral</span> : null}
                      {s.isCollateral && s.asset.ltvBps === 0n ? <span className="badge">zero LTV</span> : null}
                    </span>
                  </td>
                  <td className="num tabular">{formatTokenAmount(s.balance, s.asset.decimals)}</td>
                  <td className="num tabular muted">{formatUsd(s.balanceBase)}</td>
                  <td className="num tabular">{formatApy(s.asset.supplyApy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {view.borrowed.length > 0 ? (
        <>
          <h3 id="borrowed-heading">Borrowed</h3>
          <table className="position-table" aria-labelledby="borrowed-heading">
            <thead className="visually-hidden">
              <tr>
                <th scope="col">Asset</th>
                <th scope="col">Debt</th>
                <th scope="col">Value</th>
                <th scope="col">Borrow APY</th>
              </tr>
            </thead>
            <tbody>
              {view.borrowed.map((b) => (
                <tr key={b.asset.asset}>
                  <td>
                    <span className="position-asset">
                      <TokenIcon symbol={b.asset.symbol} />
                      <strong>{b.asset.symbol}</strong>
                    </span>
                  </td>
                  <td className="num tabular">{formatTokenAmount(b.debt, b.asset.decimals)}</td>
                  <td className="num tabular muted">{formatUsd(b.debtBase)}</td>
                  <td className="num tabular">{formatApy(b.asset.borrowApy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      <p className="muted tabular">
        Collateral {formatUsd(view.account.totalCollateralBase)} · Debt {formatUsd(view.account.totalDebtBase)} · Can
        still borrow {formatUsd(view.account.availableBorrowsBase)}
      </p>
    </div>
  )
}
