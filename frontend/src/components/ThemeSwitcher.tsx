import { Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { applyTheme, storedTheme, type Theme } from '../lib/theme'

/** Light/dark, the pill from nexlore. The choice stays in the browser. */
export function ThemeSwitcher() {
  const { t } = useTranslation()
  const [theme, setTheme] = useState<Theme>(storedTheme())
  const modes = [
    { value: 'dark' as const, label: t('theme.dark'), Icon: Moon },
    { value: 'light' as const, label: t('theme.light'), Icon: Sun },
  ]
  return (
    <div className="flex items-center rounded-full border border-ink-700 bg-ink-850 p-0.5" role="group" aria-label={t('theme.group')}>
      {modes.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => {
            applyTheme(value)
            setTheme(value)
          }}
          aria-pressed={theme === value}
          title={label}
          aria-label={label}
          className={'rounded-full p-1.5 transition-colors ' + (theme === value ? 'bg-accent-500 text-on-accent' : 'text-mist-500 hover:text-mist-100')}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      ))}
    </div>
  )
}
