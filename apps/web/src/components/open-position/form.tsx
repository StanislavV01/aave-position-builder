import { useEffect, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import { useAccount } from 'wagmi'
import { HfSlider } from './hf-slider'
import { ExecutePanel } from './execute-panel'
import { useOpenPositionPlan } from '../../lib/open-position/plan'
import { useOpenPosition } from '../../lib/open-position/execute'
import { shouldMountExecutePanel, visiblePlanReasons } from '../../lib/ui/execute-view'
import { formatHealthFactor, formatTokenAmount, healthFactorTone } from '../../lib/format'

const TONE_LABEL = { good: 'healthy', warn: 'caution', danger: 'at risk' } as const
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
  const [confirmedSummary, setConfirmedSummary] = useState<string | null>(null)
  const flow = useOpenPosition()

  const { plan, collateralView, borrowView, walletBalance, isLoading } = useOpenPositionPlan({
    chainId, collateralAsset, borrowAsset,
    collateralAmountText: amountText, borrowAmountText: borrowText,
    lastEdited, targetHfWad, eModeEnabled,
  })

  const recommended = plan?.eModeRecommended ?? false
  useEffect(() => {
    if (!eModeTouched) setEModeEnabled(recommended) // auto-on when eMode strictly improves LTV
  }, [recommended, eModeTouched])

  // On success: snapshot the executed amounts for the confirmation text (the plan loses
  // them once the inputs clear), then clear the form so the post-success balance refetch
  // cannot flag the stale amount as "exceeds wallet balance" over the confirmation.
  // Deliberately keyed on the phase alone — the closure reads the plan of the render the
  // transition happened in, which still holds the executed amounts.
  const phase = flow.state.phase
  useEffect(() => {
    if (phase !== 'confirmed') return
    if (plan?.collateral && plan.borrow) {
      setConfirmedSummary(
        `Supplied ${formatTokenAmount(plan.collateral.amount, plan.collateral.asset.decimals)} ${plan.collateral.asset.symbol}, ` +
          `borrowed ${formatTokenAmount(plan.borrow.amount, plan.borrow.asset.decimals)} ${plan.borrow.asset.symbol}.`,
      )
    }
    setAmountText('')
    setBorrowText('')
    setLastEdited('targetHf')
  }, [phase])

  if (isLoading || !collateralView || !borrowView) return <p className="muted">Loading market data…</p>

  const borrowDisplay =
    lastEdited === 'targetHf' && plan?.borrow ? formatUnits(plan.borrow.amount, borrowView.decimals) : borrowText
  const sliderValueWad =
    lastEdited === 'borrowAmount' && plan?.predictedHfWad ? plan.predictedHfWad : targetHfWad
  const reasons = plan ? visiblePlanReasons(plan.reasons, amountText !== '' || borrowText !== '') : []

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
        />
        <div className="chips">
          {[25n, 50n, 75n].map((pct) => (
            <button
              key={pct.toString()} type="button" className="chip"
              onClick={() => setAmountText(formatUnits((walletBalance * pct) / 100n, collateralView.decimals))}
            >
              {pct.toString()}%
            </button>
          ))}
          <button type="button" className="chip" onClick={() => setAmountText(formatUnits(walletBalance, collateralView.decimals))}>
            Max
          </button>
        </div>
      </div>

      {plan?.eModeCandidate && plan.eModeRecommended ? (
        <div className="field">
          <label>
            <input
              type="checkbox" checked={eModeEnabled}
              onChange={(e) => { setEModeTouched(true); setEModeEnabled(e.target.checked) }}
            />{' '}
            Enable eMode “{plan.eModeCandidate.label}” — LTV {Number(collateralView.ltvBps) / 100}% →{' '}
            {Number(plan.eModeCandidate.ltvBps) / 100}%
          </label>
        </div>
      ) : null}

      <div className="field">
        <span>Target health factor</span>
        <HfSlider
          valueWad={sliderValueWad}
          onChange={(wad) => { setLastEdited('targetHf'); setTargetHfWad(wad) }}
        />
      </div>

      <div className="field">
        <label htmlFor="borrow-amount">Borrow {borrowView.symbol}</label>
        <input
          id="borrow-amount" type="text" inputMode="decimal" placeholder="0.0"
          value={borrowDisplay}
          onChange={(e) => { setLastEdited('borrowAmount'); setBorrowText(e.target.value) }}
        />
      </div>

      {plan ? (
        <div className="notice">
          {plan.predictedHfWad !== null ? (
            <p>
              Health factor after borrow:{' '}
              <strong className={`tabular hf-${healthFactorTone(plan.predictedHfWad)}`}>
                {formatHealthFactor(plan.predictedHfWad)} · {TONE_LABEL[healthFactorTone(plan.predictedHfWad)]}
              </strong>
            </p>
          ) : null}
          <p className="muted tabular">
            Max borrow: {formatTokenAmount(plan.maxBorrow, borrowView.decimals)} {borrowView.symbol}
            {plan.bindingConstraint
              ? ` (limited by ${plan.bindingConstraint === 'ltv' ? 'LTV borrowing power' : 'available liquidity'})`
              : ''}
          </p>
          {plan.capped ? <p className="reason">Requested amount was capped to the maximum.</p> : null}
          {plan.warnLowHf ? (
            <p className="reason">Warning: below HF 1.1 a small price move can liquidate this position.</p>
          ) : null}
        </div>
      ) : null}

      {reasons.length > 0 ? (
        <div className="error-card">
          <ul>
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan && address && shouldMountExecutePanel(plan.valid, flow.state.phase) ? (
        <ExecutePanel plan={plan} chainId={chainId} address={address} flow={flow} confirmedSummary={confirmedSummary} />
      ) : null}
    </form>
  )
}
