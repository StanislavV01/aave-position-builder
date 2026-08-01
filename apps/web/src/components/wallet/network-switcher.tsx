import { MARKETS } from '@app/shared'

export function NetworkSwitcher({ chainId, onChange }: { chainId: number; onChange: (chainId: number) => void }) {
  return (
    <label>
      <span className="visually-hidden">Network</span>
      <select className="select" value={chainId} onChange={(e) => onChange(Number(e.target.value))}>
        {MARKETS.map((m) => (
          <option key={m.chainId} value={m.chainId}>
            {m.chainName}
          </option>
        ))}
      </select>
    </label>
  )
}
