import type { CSSProperties } from 'react'
import { formatHealthFactor, healthFactorTone, hfGaugePercent } from '../../lib/format'
import { TONE_LABEL } from '../shared/hf-badge'

/**
 * The health factor is THE risk number of a borrow position, so it gets the one
 * hero treatment in the app: a large tabular numeral plus a linear track from the
 * liquidation boundary (1.0) to 3.0, colored by the same healthFactorTone
 * thresholds used everywhere else. Number + scale only — no gamification.
 */
export function HfGauge({
  hfWad, caption = 'Health factor', compact = false,
}: { hfWad: bigint; caption?: string; compact?: boolean }) {
  const tone = healthFactorTone(hfWad)
  const value = formatHealthFactor(hfWad)
  const pct = hfGaugePercent(hfWad)
  return (
    <div className={compact ? 'hf-gauge hf-gauge-compact' : 'hf-gauge'}>
      <div className="hf-gauge-head">
        <span className="hf-gauge-caption">{caption}</span>
        <strong className="hf-gauge-value tabular tone-chip" data-tone={tone}>
          {value} · {TONE_LABEL[tone]}
        </strong>
      </div>
      <div
        className="hf-gauge-track"
        role="img"
        aria-label={`${caption}: ${value} — ${TONE_LABEL[tone]}. Liquidation happens below 1.0; the scale tops out at 3.`}
        style={{ '--gauge-pos': `${pct}%` } as CSSProperties}
      >
        <div className="hf-gauge-zones" aria-hidden="true">
          <span className="hf-zone" data-zone="danger" />
          <span className="hf-zone" data-zone="warn" />
          <span className="hf-zone" data-zone="good" />
        </div>
        <span className="hf-gauge-marker" aria-hidden="true" />
      </div>
      {compact ? null : (
        <div className="hf-gauge-scale" aria-hidden="true">
          <span className="tabular">1.0 — liquidation</span>
          <span className="tabular">2.0</span>
          <span className="tabular">3.0+</span>
        </div>
      )}
    </div>
  )
}
