import { useEffect, useState } from 'react'

type ThemeMode = 'system' | 'light' | 'dark'

const ORDER: ThemeMode[] = ['system', 'light', 'dark']
const LABEL: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark' }

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem('theme')
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/**
 * system / light / dark cycle. 'system' removes the override entirely so the
 * prefers-color-scheme media query rules. The stored choice is applied before
 * first paint by the inline script in index.html — this component only keeps
 * the attribute and storage in sync afterwards.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(readStored)

  useEffect(() => {
    const root = document.documentElement
    try {
      if (mode === 'system') {
        delete root.dataset.theme
        localStorage.removeItem('theme')
      } else {
        root.dataset.theme = mode
        localStorage.setItem('theme', mode)
      }
    } catch {
      /* storage unavailable (private mode) — the attribute alone still works for this tab */
    }
  }, [mode])

  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]
  return (
    <button
      type="button"
      className="ghost"
      onClick={() => setMode(next)}
      aria-label={`Theme: ${LABEL[mode]}. Switch to ${LABEL[next]}.`}
    >
      Theme: {LABEL[mode]}
    </button>
  )
}
