import { Globe, Info, LogOut, Settings, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { authApi } from '../api/client'
import { changeLanguage, languageOptions, type LanguageOption } from '../i18n'
import { useNotices } from '../lib/notices'
import { useAuth } from '../state/auth'
import { Avatar } from './Avatar'
import { NoticeList } from './Notices'
import { ThemeSwitcher } from './ThemeSwitcher'

/**
 * The round button top right, built as nexlore's: who one is, what waits (invitations), the language, the own
 * account, the settings, about nexcanvas, signing out. On a phone the light/dark switch lives here.
 */
export function AccountMenu() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { me, signOut, setMe } = useAuth()
  const notices = useNotices()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
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
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  if (!me) return null
  const item = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-mist-300 hover:bg-ink-850 hover:text-mist-100'

  return (
    <div ref={box} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={t('account.menu', { name: me.display_name || me.name })}
        className="relative flex h-8 w-8 items-center justify-center rounded-full border border-ink-700 hover:border-accent-500"
      >
        <Avatar person={me} className="h-full w-full text-sm" />
        {notices.length > 0 && (
          <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-on-accent" data-testid="notices-count">
            {notices.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 rounded-2xl border border-ink-700 bg-ink-900 p-2 text-sm shadow-2xl">
          {/* On a phone the switch has no room in the header: it lives here. */}
          <div className="flex justify-end px-3 py-2 sm:hidden">
            <ThemeSwitcher />
          </div>
          <div className="px-3 py-2">
            <div className="font-semibold text-mist-100">
              {me.display_name || me.name}
              {me.display_name && <span className="ml-1 text-xs font-normal text-mist-500">@{me.name}</span>}
            </div>
            <div className="text-xs text-mist-500">{me.role === 'operator' ? t('account.operator') : t('server.member')}</div>
          </div>
          {notices.length > 0 && (
            <div className="border-y border-ink-800 py-1" data-testid="menu-notices">
              <div className="px-3 pt-1 pb-0.5 text-xs text-mist-500">{t('notices.menu', { count: notices.length })}</div>
              <NoticeList notices={notices} />
            </div>
          )}
          <label className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
            <span className="flex items-center gap-2 text-mist-400">
              <Globe className="h-4 w-4" strokeWidth={1.8} /> {t('account.language')}
            </span>
            <select
              value={i18n.language}
              onChange={(event) => {
                const code = event.target.value
                void changeLanguage(code)
                // Kept with the account, so the next browser speaks it too.
                void authApi.language(code).then(setMe, () => undefined)
              }}
              className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-mist-100"
            >
              {languages.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <Link to="/account" onClick={() => setOpen(false)} className={item}>
            <UserRound className="h-4 w-4" strokeWidth={1.8} /> {t('account.mine')}
          </Link>
          <Link to="/settings" onClick={() => setOpen(false)} className={item}>
            <Settings className="h-4 w-4" strokeWidth={1.8} /> {t('settings.title')}
          </Link>
          <Link to="/about" onClick={() => setOpen(false)} className={item}>
            <Info className="h-4 w-4" strokeWidth={1.8} /> {t('about.menu')}
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              void signOut().then(() => navigate('/login', { replace: true }))
            }}
            className={item}
          >
            <LogOut className="h-4 w-4" strokeWidth={1.8} /> {t('account.signOut')}
          </button>
        </div>
      )}
    </div>
  )
}
