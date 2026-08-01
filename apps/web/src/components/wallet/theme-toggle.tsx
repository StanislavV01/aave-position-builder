import { useEffect, useState } from 'react'

type ThemeMode = 'system' | 'light' | 'dark'

const MODES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function parseMode(v: string | null): ThemeMode {
  return v === 'light' || v === 'dark' ? v : 'system'
}

function readStored(): ThemeMode {
  try {
    return parseMode(localStorage.getItem('theme'))
  } catch {
    return 'system'
  }
}

/**
 * Theme switcher as a segmented radio group. Native radios — not ARIA — carry the
 * semantics: exclusive selection, one tab stop, arrow-key navigation for free.
 * 'system' removes the override so the prefers-color-scheme media query rules and
 * the page follows live OS theme changes with zero JS. The stored choice is applied
 * before first paint by the inline script in index.html; this component only keeps
 * the attribute, storage, and other tabs in sync afterwards.
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

  // A change made in another tab lands here via the storage event — keep this tab in step.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'theme') setMode(parseMode(e.newValue))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <fieldset className="theme-switch">
      <legend className="visually-hidden">Theme</legend>
      {MODES.map((m) => (
        <label key={m.value} className="theme-switch-option">
          <input
            type="radio"
            name="theme"
            value={m.value}
            className="visually-hidden"
            checked={mode === m.value}
            onChange={() => setMode(m.value)}
          />
          {m.label}
        </label>
      ))}
    </fieldset>
  )
}
