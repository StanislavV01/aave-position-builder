import { useEffect, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import { useAccount } from 'wagmi'
import { HfSlider } from './hf-slider'
import { ExecutePanel } from './execute-panel'
import { useOpenPositionPlan } from '../../lib/open-position/plan'
import { useOpenPosition } from '../../lib/open-position/execute'
import { isFlowInFlight, shouldMountExecutePanel, visiblePlanReasons } from '../../lib/ui/execute-view'
import { HfGauge } from '../position/hf-gauge'
import { formatTokenAmount, trimAmountText } from '../../lib/format'

const DEFAULT_TARGET_HF = 2n * 10n ** 18n

export function OpenPositionForm({
  chainId, collateralAsset, borrowAsset,
}: { chainId: number; collateralAsset: Address; borrowAsset: Address }) {
  const { address } = useAccount()
  const [amountText, setAmountText] = useState('')
  const [borrowText, setBorrowText] = useState('')
  const [lastEdited, setLastEdited] = useState<'targetHf' | 'borrowAmount'>('targetHf')
  const [targetHfWad, setTargetHfWad] = useState<bigint>(DEFAULT_TARGET_HF)
  const [eModeEnabled, setEModeEnabled] = useState(false)
  const [eModeTouched, setEModeTouched] = useState(false)
  const flow = useOpenPosition()

  const { plan, collateralView, borrowView, walletBalance, isLoading, dataError, refetchMarketData } =
    useOpenPositionPlan({
      chainId, collateralAsset, borrowAsset,
      collateralAmountText: amountText, borrowAmountText: borrowText,
      lastEdited, targetHfWad, eModeEnabled,
    })

  const recommended = plan?.eModeRecommended ?? false
  useEffect(() => {
    if (!eModeTouched) setEModeEnabled(recommended) // auto-on when eMode strictly improves LTV
  }, [recommended, eModeTouched])

  // Clear the form on success so the post-success balance refetch cannot flag the stale
  // amount as "exceeds wallet balance" over the confirmation. The confirmation's own
  // "Supplied X, borrowed Y" text is snapshotted by the ExecutePanel at the moment the
  // driver starts — from the exact executed amounts, not this live plan.
  const phase = flow.state.phase
  useEffect(() => {
    if (phase !== 'confirmed') return
    setAmountText('')
    setBorrowText('')
    setLastEdited('targetHf')
  }, [phase])
  // Freeze the inputs while a driver runs: the executed amounts are already locked in,
  // and a live position-event refetch mid-flow must not re-derive the plan under the user.
  const flowInFlight = isFlowInFlight(phase)

  if (dataError) {
    return (
      <div className="error-card" role="alert">
        Could not load market data.{' '}
        <button type="button" className="ghost" onClick={refetchMarketData}>
          Retry
        </button>
      </div>
    )
  }
  if (isLoading || !collateralView || !borrowView) return <p className="muted">Loading market data…</p>

  const borrowDisplay =
    lastEdited === 'targetHf' && plan?.borrow && amountText !== ''
      ? trimAmountText(formatUnits(plan.borrow.amount, borrowView.decimals))
      : borrowText
  const sliderValueWad =
    lastEdited === 'borrowAmount' && plan?.predictedHfWad ? plan.predictedHfWad : targetHfWad
  const reasons = plan ? visiblePlanReasons(plan.reasons, amountText !== '' || borrowText !== '', flowInFlight) : []

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <div className="field">
        <label htmlFor="collateral-amount">
          Supply {collateralView.symbol} — wallet:{' '}
          <span className="tabular">{formatTokenAmount(walletBalance, collateralView.decimals)}</span>
        </label>
        <input
          id="collateral-amount" type="text" inputMode="decimal" placeholder="0.0"
          value={amountText} onChange={(e) => setAmountText(e.target.value)}
          disabled={flowInFlight}
          aria-invalid={reasons.length > 0 || undefined}
          aria-describedby={reasons.length > 0 ? 'plan-errors' : undefined}
        />
        <div className="chips">
          {[25n, 50n, 75n].map((pct) => (
            <button
              key={pct.toString()} type="button" className="chip" disabled={flowInFlight}
              onClick={() => setAmountText(formatUnits((walletBalance * pct) / 100n, collateralView.decimals))}
            >
              {pct.toString()}%
            </button>
          ))}
          <button
            type="button" className="chip" disabled={flowInFlight}
            onClick={() => setAmountText(formatUnits(walletBalance, collateralView.decimals))}
          >
            Max
          </button>
        </div>
      </div>

      {plan?.eModeCandidate && plan.eModeRecommended ? (
        <div className="field">
          <label>
            <input
              type="checkbox" checked={eModeEnabled} disabled={flowInFlight}
              onChange={(e) => { setEModeTouched(true); setEModeEnabled(e.target.checked) }}
            />{' '}
            Enable eMode “{plan.eModeCandidate.label}” — LTV {Number(collateralView.ltvBps) / 100}% →{' '}
            {Number(plan.eModeCandidate.ltvBps) / 100}%
          </label>
          <span className="reason">
            Efficiency mode: higher borrowing power for correlated assets. It also changes the liquidation
            threshold for this category.
          </span>
        </div>
      ) : null}

      <div className="field">
        <span>Target health factor</span>
        <HfSlider
          valueWad={sliderValueWad}
          disabled={flowInFlight}
          onChange={(wad) => { setLastEdited('targetHf'); setTargetHfWad(wad) }}
        />
      </div>

      <div className="field">
        <label htmlFor="borrow-amount">Borrow {borrowView.symbol}</label>
        <input
          id="borrow-amount" type="text" inputMode="decimal" placeholder="0.0"
          value={borrowDisplay}
          onChange={(e) => { setLastEdited('borrowAmount'); setBorrowText(e.target.value) }}
          disabled={flowInFlight}
          aria-invalid={reasons.length > 0 || undefined}
          aria-describedby={reasons.length > 0 ? 'plan-errors' : undefined}
        />
      </div>

      {plan ? (
        <div className="notice">
          {plan.predictedHfWad !== null ? (
            <HfGauge hfWad={plan.predictedHfWad} caption="Health factor after borrow" compact />
          ) : null}
          <p className="muted tabular">
            Max borrow: {formatTokenAmount(plan.maxBorrow, borrowView.decimals)} {borrowView.symbol}
            {plan.bindingConstraint
              ? ` (limited by ${plan.bindingConstraint === 'ltv' ? 'LTV borrowing power' : 'available liquidity'})`
              : ''}
          </p>
          {plan.capped ? <p className="reason" role="status">Requested amount was capped to the maximum.</p> : null}
          {plan.warnLowHf ? (
            <p className="tone-banner" data-tone="warn" role="status">
              Warning: below HF 1.1 a small price move can liquidate this position.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* The live region wrapper is always mounted — a region inserted together with its
          content is skipped by most screen readers, so the first validation errors would
          otherwise be silent. */}
      <div aria-live="polite">
        {reasons.length > 0 ? (
          <div className="error-card" id="plan-errors">
            <ul>
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {plan && address && shouldMountExecutePanel(plan.valid, flow.state.phase, flow.notice !== null) ? (
        <ExecutePanel plan={plan} chainId={chainId} address={address} flow={flow} />
      ) : null}
    </form>
  )
}
