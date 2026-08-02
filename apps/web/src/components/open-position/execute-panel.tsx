import { useState } from 'react'
import type { Address } from 'viem'
import { marketByChainId } from '@app/shared'
import type { OpenPositionPlan } from '../../lib/open-position/plan'
import type { ExecutablePlan, OpenPositionFlow } from '../../lib/open-position/execute'
import { isFlowInFlight } from '../../lib/ui/execute-view'
import { usePermitSupport, useTokenState } from '../../lib/data/token-queries'
import { formatTokenAmount } from '../../lib/format'
import { TxProgress } from './tx-progress'

export function ExecutePanel({
  plan, chainId, address, flow,
}: { plan: OpenPositionPlan; chainId: number; address: Address; flow: OpenPositionFlow }) {
  const market = marketByChainId(chainId)
  const collateral = plan.collateral
  const borrow = plan.borrow
  const permitSupport = usePermitSupport(chainId, collateral?.asset.asset)
  const tokenState = useTokenState(chainId, address, collateral?.asset.asset)
  const { state, notice, open, runSequential, reset } = flow
  // Guards the error-card buttons against a double-click: runSequential() dispatches
  // FALLBACK_START (which flips state.phase away from 'error', unmounting this card) only
  // after its first await, so a second click landing before that re-render would otherwise
  // fire a second sequential run or race a Dismiss against it. True for the click-to-dispatch
  // gap only — same busy-style guard as the primary CTA's `disabled={busy}` below.
  const [sequentialStarting, setSequentialStarting] = useState(false)
  // "Supplied X, borrowed Y" captured at the moment a driver starts, from the exact
  // amounts handed to it. The live plan keeps re-deriving while the flow runs (and the
  // inputs are cleared on success), so reading it at confirm time would report amounts
  // that were never executed.
  const [executedSummary, setExecutedSummary] = useState<string | null>(null)

  if (!market) return null
  // The flow-status UI below must render even when the plan is no longer executable
  // (inputs cleared after success, or edited mid-flight) — only the CTA needs a live plan.
  const canExecute = plan.valid && collateral !== null && borrow !== null
  const supportPending = canExecute && (permitSupport.isPending || tokenState.isPending)

  const permit = permitSupport.data?.supported
    ? { version: permitSupport.data.version, name: permitSupport.data.name }
    : null
  const allowance = tokenState.data?.allowance ?? 0n
  const executable: ExecutablePlan | null =
    canExecute && collateral && borrow
      ? {
          market,
          user: address,
          collateralAsset: collateral.asset.asset,
          collateralAmount: collateral.amount,
          borrowAsset: borrow.asset.asset,
          borrowAmount: borrow.amount,
          eModeCategoryToSet: plan.eModeCategoryToSet,
          permit,
          currentAllowance: allowance,
        }
      : null

  const startFlow = (runner: (p: ExecutablePlan) => Promise<void>) => {
    if (!executable || !collateral || !borrow) return
    setExecutedSummary(
      `Supplied ${formatTokenAmount(collateral.amount, collateral.asset.decimals)} ${collateral.asset.symbol}, ` +
        `borrowed ${formatTokenAmount(borrow.amount, borrow.asset.decimals)} ${borrow.asset.symbol}.`,
    )
    void runner(executable)
  }

  const needsApproveTx = permit === null && allowance < (collateral?.amount ?? 0n)
  const busy = isFlowInFlight(state.phase)
  const explorer = chainId === 8453 ? 'https://basescan.org' : 'https://sepolia.basescan.org'
  const label = permit
    ? 'Sign permit & open position (1 transaction)'
    : needsApproveTx
      ? 'Approve & open position (2 transactions)'
      : 'Open position (1 transaction)'

  return (
    <div>
      {state.phase === 'confirmed' ? (
        <button type="button" className="cta" onClick={() => reset()}>
          Open another position
        </button>
      ) : supportPending ? (
        <p className="muted">Checking token support…</p>
      ) : executable ? (
        <button type="button" className="cta" disabled={busy} onClick={() => startFlow(open)}>
          {busy ? 'Working…' : label}
        </button>
      ) : null}
      {/* The live region must exist BEFORE content changes inside it, or screen readers
          skip the first announcements — so the wrapper is always mounted and TxProgress
          mounts/unmounts within it (its <ol>s no longer carry their own aria-live). */}
      <div aria-live="polite">
        <TxProgress state={state} permitPath={permit !== null} />
      </div>
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      {state.phase === 'error' ? (
        <div className="error-card" role="alert" tabIndex={-1}>
          <p>{state.message}</p>
          {state.suggestSequential && executable ? (
            <button
              type="button"
              className="ghost"
              disabled={sequentialStarting}
              onClick={() => {
                setSequentialStarting(true)
                startFlow((p) => runSequential(p).finally(() => setSequentialStarting(false)))
              }}
            >
              Try step-by-step instead
            </button>
          ) : null}
          <button type="button" className="ghost" disabled={sequentialStarting} onClick={() => reset()}>
            Dismiss
          </button>
        </div>
      ) : null}
      {state.phase === 'confirmed' ? (
        <p className="notice" role="status">
          Position opened in block <span className="tabular">{state.blockNumber.toString()}</span> —{' '}
          <a href={`${explorer}/tx/${state.txHash}`} target="_blank" rel="noreferrer">
            view on Basescan
          </a>
          .{executedSummary ? ` ${executedSummary}` : ''}
        </p>
      ) : null}
    </div>
  )
}
