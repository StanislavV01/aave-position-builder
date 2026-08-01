import type { CSSProperties } from 'react'

// SVGs vendored from github.com/bgd-labs/icons (assets/tokens/<symbol>_full.svg) for the
// reserves listed on the two target markets. Unknown symbols fall back to an initials disc,
// so a testnet listing a new token degrades gracefully instead of breaking the row.
const ICON_URLS = import.meta.glob('../../assets/tokens/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const BY_SYMBOL = new Map(
  Object.entries(ICON_URLS).map(([path, url]) => [path.split('/').pop()!.replace('.svg', ''), url]),
)

export function TokenIcon({ symbol, size = 20 }: { symbol: string; size?: number }) {
  const url = BY_SYMBOL.get(symbol.toLowerCase())
  if (!url) {
    return (
      <span
        className="token-icon token-icon-fallback"
        style={{ '--icon-size': `${size}px` } as CSSProperties}
        aria-hidden="true"
      >
        {symbol.slice(0, 2)}
      </span>
    )
  }
  // alt="" — decorative: the symbol text always sits right next to the icon.
  return <img className="token-icon" src={url} alt="" width={size} height={size} loading="lazy" />
}
