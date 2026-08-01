import { formatHealthFactor, healthFactorTone } from '../../lib/format'

/** The one place the tone → human label mapping lives (was duplicated per component). */
export const TONE_LABEL = { good: 'healthy', warn: 'caution', danger: 'at risk' } as const

export function HfBadge({ hfWad }: { hfWad: bigint }) {
  const tone = healthFactorTone(hfWad)
  return (
    <strong className="tabular tone-chip" data-tone={tone}>
      {formatHealthFactor(hfWad)} · {TONE_LABEL[tone]}
    </strong>
  )
}
