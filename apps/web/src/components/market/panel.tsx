import type { Address } from 'viem'
import type { MarketAssetView } from '../../lib/derived'
import { formatApy } from '../../lib/format'

interface MarketPanelProps {
  assets: MarketAssetView[]
  selectedSupply: Address | null
  selectedBorrow: Address | null
  onSelectSupply: (asset: Address) => void
  onSelectBorrow: (asset: Address) => void
}

function AssetRow({
  asset, enabled, reason, apy, apyLabel, selected, onSelect,
}: {
  asset: MarketAssetView
  enabled: boolean
  reason: string | null
  apy: number
  apyLabel: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button className="asset-row" disabled={!enabled} aria-pressed={selected} onClick={onSelect}>
        <strong>{asset.symbol}</strong>
        {enabled ? (
          <span className="apy tabular">
            {formatApy(apy)} {apyLabel}
          </span>
        ) : (
          <span className="reason apy">{reason}</span>
        )}
      </button>
    </li>
  )
}

export function MarketPanel({ assets, selectedSupply, selectedBorrow, onSelectSupply, onSelectBorrow }: MarketPanelProps) {
  return (
    <div>
      <h3 className="muted">Supply as collateral</h3>
      <ul className="asset-list">
        {assets.map((a) => (
          <AssetRow
            key={`s-${a.asset}`}
            asset={a}
            enabled={a.canSupply}
            reason={a.supplyDisabledReason}
            apy={a.supplyApy}
            apyLabel="APY"
            selected={selectedSupply?.toLowerCase() === a.asset.toLowerCase()}
            onSelect={() => onSelectSupply(a.asset)}
          />
        ))}
      </ul>
      <h3 className="muted">Borrow</h3>
      <ul className="asset-list">
        {assets.map((a) => (
          <AssetRow
            key={`b-${a.asset}`}
            asset={a}
            enabled={a.canBorrow}
            reason={a.borrowDisabledReason}
            apy={a.borrowApy}
            apyLabel="APY (variable)"
            selected={selectedBorrow?.toLowerCase() === a.asset.toLowerCase()}
            onSelect={() => onSelectBorrow(a.asset)}
          />
        ))}
      </ul>
    </div>
  )
}
