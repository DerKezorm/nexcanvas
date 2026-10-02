import { Check, LogOut, Settings, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { authApi } from '../api/client'
import { changeLanguage, languageOptions, type LanguageOption } from '../i18n'
import { useAuth } from '../state/auth'
import { Avatar } from './Avatar'
import { ThemeSwitcher } from './ThemeSwitcher'

/** The round button top right, as in nexlore: account, settings, language, sign out. */
export function AccountMenu() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { me, signOut, setMe } = useAuth()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const [languages, setLanguages] = useState<LanguageOption[]>([
    { code: 'de', name: 'Deutsch', added: false },
    { code: 'en', name: 'English', added: false },
  ])
  // The operator's languages join the two shipped ones once the menu opens.
  useEffect(() => {
    if (open) void languageOptions().then(setLanguages)
  }, [open])

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  if (!me) return null
  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  return (
    <div ref={root} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label={t('account.menu')} aria-expanded={open} className="block rounded-full">
        <Avatar person={me} className="h-8 w-8 text-sm" />
      </button>
      {open && (
        <div role="menu" className="nc-menu absolute top-full right-0 mt-2 w-64">
          <div className="flex items-center gap-3 px-2.5 pt-2 pb-3">
            <Avatar person={me} className="h-9 w-9 text-sm" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-mist-100">{me.display_name || me.name}</div>
              <div className="truncate text-xs text-mist-600">{me.role === 'operator' ? t('account.operator') : me.name}</div>
            </div>
          </div>
          <div className="my-1 h-px bg-ink-700" />
          <button type="button" role="menuitem" className="nc-menu-item" onClick={() => go('/account')}>
            <UserRound className="h-4 w-4 text-mist-500" />
            {t('account.mine')}
          </button>
          <button type="button" role="menuitem" className="nc-menu-item" onClick={() => go('/settings')}>
            <Settings className="h-4 w-4 text-mist-500" />
            {t('settings.title')}
          </button>
          <div className="my-1 h-px bg-ink-700" />
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <span className="text-xs text-mist-500">{t('account.language')}</span>
            <div className="flex rounded-full border border-ink-700 bg-ink-900 p-0.5">
              {languages.map(({ code, name }) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => {
                    void changeLanguage(code)
                    // Kept with the account, so the next browser speaks it too.
                    void authApi.language(code).then(setMe, () => undefined)
                  }}
                  aria-pressed={i18n.language === code}
                  title={name}
                  aria-label={name}
                  className={'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ' + (i18n.language === code ? 'bg-accent-500 text-on-accent' : 'text-mist-500 hover:text-mist-100')}
                >
                  {i18n.language === code && <Check className="h-3 w-3" />}
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between px-2.5 py-1.5 sm:hidden">
            <span className="text-xs text-mist-500">{t('theme.group')}</span>
            <ThemeSwitcher />
          </div>
          <div className="my-1 h-px bg-ink-700" />
          <button
            type="button"
            role="menuitem"
            className="nc-menu-item"
            onClick={() => {
              setOpen(false)
              void signOut().then(() => navigate('/login'))
            }}
          >
            <LogOut className="h-4 w-4 text-mist-500" />
            {t('account.signOut')}
          </button>
        </div>
      )}
    </div>
  )
}
