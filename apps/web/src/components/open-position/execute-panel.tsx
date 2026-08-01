import { useState } from 'react'
import type { Address } from 'viem'
import { marketByChainId } from '@app/shared'
import type { OpenPositionPlan } from '../../lib/plan'
import { useOpenPosition, type ExecutablePlan } from '../../lib/execute'
import { usePermitSupport, useTokenState } from '../../lib/token-queries'
import { formatTokenAmount } from '../../lib/format'
import { TxProgress } from './tx-progress'

export function ExecutePanel({ plan, chainId, address }: { plan: OpenPositionPlan; chainId: number; address: Address }) {
  const market = marketByChainId(chainId)
  const collateral = plan.collateral
  const borrow = plan.borrow
  const permitSupport = usePermitSupport(chainId, collateral?.asset.asset)
  const tokenState = useTokenState(chainId, address, collateral?.asset.asset)
  const { state, notice, open, runSequential, reset } = useOpenPosition()
  // Guards the error-card buttons against a double-click: runSequential() dispatches
  // FALLBACK_START (which flips state.phase away from 'error', unmounting this card) only
  // after its first await, so a second click landing before that re-render would otherwise
  // fire a second sequential run or race a Dismiss against it. True for the click-to-dispatch
  // gap only — same busy-style guard as the primary CTA's `disabled={busy}` below.
  const [sequentialStarting, setSequentialStarting] = useState(false)

  if (!market || !collateral || !borrow) return null
  if (!plan.valid) return null
  if (permitSupport.isPending || tokenState.isPending) return <p className="muted">Checking token support…</p>

  const permit = permitSupport.data?.supported
    ? { version: permitSupport.data.version, name: permitSupport.data.name }
    : null
  const allowance = tokenState.data?.allowance ?? 0n
  const executable: ExecutablePlan = {
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
  const needsApproveTx = permit === null && allowance < collateral.amount
  const busy = state.phase !== 'idle' && state.phase !== 'error' && state.phase !== 'confirmed'
  const explorer = chainId === 8453 ? 'https://basescan.org' : 'https://sepolia.basescan.org'
  const label = permit
    ? 'Sign permit & open position (1 transaction)'
    : needsApproveTx
      ? 'Approve & open position (2 transactions)'
      : 'Open position (1 transaction)'

  return (
    <div>
      <button className="cta" disabled={busy} onClick={() => void open(executable)}>
        {busy ? 'Working…' : label}
      </button>
      <TxProgress state={state} permitPath={permit !== null} />
      {notice ? <p className="notice">{notice}</p> : null}
      {state.phase === 'error' ? (
        <div className="error-card" role="alert" tabIndex={-1}>
          <p>{state.message}</p>
          {state.suggestSequential ? (
            <button
              className="ghost"
              disabled={sequentialStarting}
              onClick={() => {
                setSequentialStarting(true)
                void runSequential(executable).finally(() => setSequentialStarting(false))
              }}
            >
              Try step-by-step instead
            </button>
          ) : null}
          {state.canRetry ? (
            <button className="ghost" disabled={sequentialStarting} onClick={() => reset()}>
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
      {state.phase === 'confirmed' ? (
        <p className="notice">
          Position opened in block <span className="tabular">{state.blockNumber.toString()}</span> —{' '}
          <a href={`${explorer}/tx/${state.txHash}`} target="_blank" rel="noreferrer">
            view on Basescan
          </a>
          . Supplied {formatTokenAmount(collateral.amount, collateral.asset.decimals)} {collateral.asset.symbol},
          borrowed {formatTokenAmount(borrow.amount, borrow.asset.decimals)} {borrow.asset.symbol}.
        </p>
      ) : null}
    </div>
  )
}
