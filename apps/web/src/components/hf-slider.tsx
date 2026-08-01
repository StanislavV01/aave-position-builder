import { formatHealthFactor, hfWadToNumber, numberToHfWad } from '../lib/format'

const PRESETS = [
  { label: 'Conservative 2.0', value: 2.0 },
  { label: 'Moderate 1.5', value: 1.5 },
  { label: 'Aggressive 1.1', value: 1.1 },
]

export function HfSlider({
  valueWad, onChange, disabled = false,
}: { valueWad: bigint; onChange: (wad: bigint) => void; disabled?: boolean }) {
  const value = Math.min(3, Math.max(1.05, hfWadToNumber(valueWad)))
  return (
    <div>
      <div className="slider-row">
        <input
          type="range" min={1.05} max={3} step={0.01} value={value} disabled={disabled}
          aria-label="Target health factor"
          aria-valuetext={`Target health factor ${formatHealthFactor(valueWad)}`}
          onChange={(e) => onChange(numberToHfWad(Number(e.target.value)))}
        />
        <output className="tabular">{formatHealthFactor(valueWad)}</output>
      </div>
      <div className="chips">
        {PRESETS.map((p) => (
          <button key={p.value} type="button" className="chip" disabled={disabled} onClick={() => onChange(numberToHfWad(p.value))}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
