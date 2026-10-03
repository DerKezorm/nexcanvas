/**
 * Settings and the own account, laid out like nexlore's: whoever knows one finds their way in the other.
 * Settings: General, Look, Spaces, and for the operator Server, with a second row for its parts. The tab is in the
 * address (`?tab=server&sub=backups`), so a link can point at one; a tab someone may not see falls back to General.
 * Account: Profile, Security.
 */
import {
  Box,
  Download,
  Eye,
  Files,
  Globe,
  History,
  House,
  Info,
  KeyRound,
  Lock,
  LogOut,
  MousePointer2,
  Palette,
  RotateCcw,
  Shapes,
  Shield,
  ShieldCheck,
  Upload,
  UserRound,
  Users,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { api, authApi, type Me, type Methods, type Preferences } from '../api/client'
import { useBoards, type Space } from '../board/store'
import { Avatar } from '../components/Avatar'
import { Dialog } from '../components/Dialog'
import { MembersDialog } from '../components/MembersDialog'
import { PackageList } from '../components/ShapePackages'
import { changeLanguage, languageOptions, templateFile, type LanguageOption } from '../i18n'
import { applyTheme, storedTheme, type Theme } from '../lib/theme'
import { useAuth } from '../state/auth'
import { AccountsCard, AllSpacesCard, BackupsCard, FilesCard, LanguagesCard, LogCard, MailCard, SharesCard, SignInCard, useServerSettings } from './settings/ServerCards'
import { Button, Card, Feedback, Input, saveAsFile, Select, TabRow, Toggle, useAction, type Tab } from './settings/ui'

type Top = 'general' | 'looks' | 'spaces' | 'server'
type Part = 'accounts' | 'signin' | 'shares' | 'files' | 'shapes' | 'backups' | 'languages' | 'log'
const TOPS: Top[] = ['general', 'looks', 'spaces', 'server']
const PARTS: Part[] = ['accounts', 'signin', 'shares', 'files', 'shapes', 'backups', 'languages', 'log']
const TOP_ICON = { general: Globe, looks: Eye, spaces: Box, server: ShieldCheck }
const PART_ICON = { accounts: Users, signin: KeyRound, shares: Globe, files: Files, shapes: Shapes, backups: History, languages: Globe, log: Info }

export function SettingsPage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const [params, setParams] = useSearchParams()
  const operator = me?.role === 'operator'
  const asked = params.get('tab') as Top | null
  const top: Top = asked && TOPS.includes(asked) && (asked !== 'server' || operator) ? asked : 'general'
  const askedPart = params.get('sub') as Part | null
  const part: Part = askedPart && PARTS.includes(askedPart) ? askedPart : 'accounts'
  const go = (next: Top, sub?: Part) => setParams(next === 'general' ? {} : sub ? { tab: next, sub } : { tab: next }, { replace: true })

  const tops: Tab<Top>[] = TOPS.filter((value) => value !== 'server' || operator).map((value) => ({ value, label: t(`settings.tabs.${value}`), icon: TOP_ICON[value] }))
  const parts: Tab<Part>[] = PARTS.map((value) => ({ value, label: t(`settings.parts.${value}`), icon: PART_ICON[value] }))

  return (
    <main className="nc-scroll min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-bold tracking-tight text-mist-100">{t('settings.title')}</h1>
        <TabRow tabs={tops} active={top} onChange={(value) => go(value)} label={t('settings.title')} />
        {top === 'server' && <TabRow under tabs={parts} active={part} onChange={(value) => go('server', value)} label={t('settings.tabs.server')} />}
        <div className="space-y-6 pt-1">
          {top === 'general' && <General />}
          {top === 'looks' && <Looks />}
          {top === 'spaces' && <Spaces />}
          {top === 'server' && <ServerPart part={part} />}
        </div>
      </div>
    </main>
  )
}

/** One part of the server, for the operator. */
function ServerPart({ part }: { part: Part }) {
  const { t } = useTranslation()
  const server = useServerSettings()
  switch (part) {
    case 'accounts':
      return (
        <>
          <AccountsCard />
          <AllSpacesCard />
          <MailCard server={server} />
        </>
      )
    case 'signin':
      return <SignInCard server={server} />
    case 'shares':
      return <SharesCard server={server} />
    case 'files':
      return <FilesCard server={server} />
    case 'shapes':
      return (
        <Card id="shape-packages" icon={Shapes} title={t('packages.serverTitle')} text={t('packages.serverText')}>
          <PackageList space={null} canChange />
        </Card>
      )
    case 'backups':
      return <BackupsCard server={server} />
    case 'languages':
      return <LanguagesCard />
    case 'log':
      return <LogCard />
  }
}

function usePreferences() {
  const { me, setMe } = useAuth()
  const action = useAction()
  const change = (patch: Partial<Preferences>) =>
    void action.run(async () => {
      const next = await authApi.preferences(patch)
      if (me) setMe({ ...me, preferences: next } as Me)
    })
  return { preferences: me?.preferences, change, action }
}

function General() {
  const { t } = useTranslation()
  const { preferences, change, action } = usePreferences()
  if (!preferences) return null
  return (
    <>
      <LanguageCard />
      <Card icon={House} title={t('settings.start.title')} text={t('settings.start.text')}>
        <Select
          label={t('settings.startPage')}
          value={preferences.start}
          onChange={(start) => change({ start })}
          options={[
            { value: 'boards', label: t('boards.all') },
            { value: 'last', label: t('settings.lastBoard') },
          ]}
        />
        <Feedback problem={action.problem} />
      </Card>
      <Card icon={MousePointer2} title={t('settings.board.title')} text={t('settings.board.text')}>
        <Toggle label={t('settings.snap')} hint={t('settings.snapHint')} checked={preferences.snap} onChange={(snap) => change({ snap })} />
        <Toggle label={t('settings.toolBack')} hint={t('settings.toolBackHint')} checked={preferences.tool_back} onChange={(tool_back) => change({ tool_back })} />
        <Feedback problem={action.problem} />
      </Card>
    </>
  )
}

function LanguageCard() {
  const { t, i18n } = useTranslation()
  const { me, setMe } = useAuth()
  const operator = me?.role === 'operator'
  const [options, setOptions] = useState<LanguageOption[]>([])
  useEffect(() => {
    let alive = true
    void languageOptions().then((list) => alive && setOptions(list))
    return () => {
      alive = false
    }
  }, [])
  return (
    <Card icon={Globe} title={t('settings.language.title')} text={operator ? t('settings.language.text') : t('settings.language.textMember')}>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-sm">
        <label htmlFor="language" className="font-medium text-mist-100">
          {t('settings.language.choose')}
        </label>
        <select
          id="language"
          value={i18n.language}
          onChange={(e) => {
            const code = e.target.value
            void changeLanguage(code)
            // Kept with the account, so the next browser speaks it too.
            void authApi.language(code).then(setMe, () => undefined)
          }}
          className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-sm text-mist-100"
        >
          {options.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
              {option.added ? ` (${t('settings.language.added')})` : ''}
            </option>
          ))}
        </select>
        {operator && (
          <button
            type="button"
            onClick={() => saveAsFile('nexcanvas-language-template.json', templateFile())}
            className="ml-auto inline-flex items-center gap-2 rounded-full border border-ink-700 px-3.5 py-1.5 text-sm text-mist-300 hover:bg-ink-800"
            title={t('settings.language.templateHint')}
          >
            <Download className="h-4 w-4" strokeWidth={1.8} /> {t('settings.language.template')}
          </button>
        )}
      </div>
      {operator && <p className="text-xs text-mist-500">{t('settings.language.templateHint')}</p>}
    </Card>
  )
}

/** Light or dark (kept in this browser, as the switch in the header), and how the board looks. */
function Looks() {
  const { t } = useTranslation()
  const { preferences, change, action } = usePreferences()
  const [theme, setTheme] = useState<Theme>(storedTheme())
  if (!preferences) return null
  return (
    <>
      <Card icon={Palette} title={t('settings.looks.title')} text={t('settings.looks.text')}>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('theme.group')}>
          {(['dark', 'light'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              onClick={() => {
                applyTheme(value)
                setTheme(value)
              }}
              className={
                'rounded-full border px-4 py-2 text-sm font-medium ' +
                (theme === value ? 'border-accent-500/60 bg-accent-500/15 text-accent-400' : 'border-ink-700 bg-ink-900 text-mist-500 hover:text-mist-100')
              }
            >
              {t(`theme.${value}`)}
            </button>
          ))}
        </div>
      </Card>
      <Card icon={Eye} title={t('settings.looks.board')} text={t('settings.looks.boardText')}>
        <Toggle label={t('settings.grid')} hint={t('settings.gridHint')} checked={preferences.dots} onChange={(dots) => change({ dots })} />
        <Feedback problem={action.problem} />
      </Card>
    </>
  )
}

function Spaces() {
  const { t } = useTranslation()
  const boards = useBoards()
  const [members, setMembers] = useState<Space | null>(null)
  const [params, setParams] = useSearchParams()
  const asked = Number(params.get('packages')) || null
  const packagesOf = boards.spaces.find((s) => s.id === asked) ?? null
  const [bin, setBin] = useState<{ id: number; name: string; color: string; deleted_at: string }[]>([])
  const action = useAction()
  useEffect(() => {
    api<{ id: number; name: string; color: string; deleted_at: string }[]>('/api/spaces/bin').then(setBin, () => undefined)
  }, [])
  return (
    <>
      <Card icon={Box} title={t('settings.spacesMine')} text={t('settings.spacesHint')}>
        <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700">
          {boards.spaces.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate font-medium text-mist-100">{s.name}</span>
              <span className="text-xs text-mist-500">
                {t(`roles.${s.role}`)} · {t('boards.count', { count: s.boards })}
              </span>
              <span className="flex -space-x-1.5">
                {s.members.slice(0, 5).map((m) => (
                  <Avatar key={m.id} person={m} className="h-6 w-6 text-[11px]" ring />
                ))}
              </span>
              {s.role === 'manage' && (
                <Button small onClick={() => setParams({ tab: 'spaces', packages: String(s.id) }, { replace: true })}>
                  <Shapes className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {t('packages.title')}
                </Button>
              )}
              <Button small onClick={() => setMembers(s)}>
                <Users className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t('share.manage')}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      {bin.length > 0 && (
        <Card icon={RotateCcw} title={t('settings.spacesBin')} text={t('settings.spacesBinHint')}>
          <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700">
            {bin.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 text-mist-200">{s.name}</span>
                <Button
                  small
                  busy={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await api(`/api/spaces/${s.id}/restore`, { method: 'POST' })
                      setBin((list) => list.filter((x) => x.id !== s.id))
                      await boards.refresh()
                    })
                  }
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {t('files.restore')}
                </Button>
              </li>
            ))}
          </ul>
          <Feedback problem={action.problem} />
        </Card>
      )}
      {members && <MembersDialog space={members} onClose={() => setMembers(null)} />}
      {packagesOf && (
        <Dialog title={t('packages.spaceTitle', { space: packagesOf.name })} onClose={() => setParams({ tab: 'spaces' }, { replace: true })} wide>
          <p className="mb-3 text-sm text-mist-500">{t('packages.spaceText')}</p>
          <PackageList space={packagesOf.id} canChange={packagesOf.role === 'manage'} />
        </Dialog>
      )}
    </>
  )
}

// --- The own account ------------------------------------------------------------------------------------------------

type AccountPart = 'profile' | 'security'

export function AccountPage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const [params, setParams] = useSearchParams()
  // Back from the provider (linking the account): its answer stands on the security tab.
  const asked = params.get('tab')
  const part: AccountPart = asked === 'security' || params.get('linked') || params.get('error') ? 'security' : 'profile'
  if (!me) return null
  const tabs: Tab<AccountPart>[] = [
    { value: 'profile', label: t('account.profile'), icon: UserRound },
    { value: 'security', label: t('account.security'), icon: Shield },
  ]
  return (
    <main className="nc-scroll min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-bold tracking-tight text-mist-100">{t('account.mine')}</h1>
        <TabRow tabs={tabs} active={part} onChange={(value) => setParams(value === 'profile' ? {} : { tab: value }, { replace: true })} label={t('account.mine')} />
        <div className="space-y-6 pt-1">
          {part === 'profile' && <Profile me={me} />}
          {part === 'security' && <Security me={me} />}
        </div>
      </div>
    </main>
  )
}

function Profile({ me }: { me: Me }) {
  const { t } = useTranslation()
  const { setMe } = useAuth()
  const [shown, setShown] = useState(me.display_name)
  const picture = useRef<HTMLInputElement>(null)
  const action = useAction()
  return (
    <Card icon={UserRound} title={t('account.profile')} text={t('account.profileText')}>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar person={me} className="h-16 w-16 text-2xl" />
        <Button onClick={() => picture.current?.click()} busy={action.busy}>
          <Upload className="h-4 w-4" strokeWidth={1.8} />
          {t('account.picture')}
        </Button>
        {me.avatar && (
          <Button danger busy={action.busy} onClick={() => void action.run(async () => setMe(await api<Me>('/api/auth/avatar', { method: 'DELETE' })))}>
            {t('account.pictureRemove')}
          </Button>
        )}
        <input
          ref={picture}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void action.run(async () => setMe(await api<Me>('/api/auth/avatar', { method: 'PUT', raw: file })))
          }}
        />
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void action.run(async () => setMe(await authApi.profile(shown.trim())), t('settings.saved'))
        }}
      >
        <Input label={t('account.displayName')} value={shown} onChange={setShown} hint={t('account.displayNameHint', { name: me.name })} className="min-w-60 flex-1" />
        <Button type="submit" accent busy={action.busy}>
          {t('common.save')}
        </Button>
      </form>
      <Feedback problem={action.problem} done={action.done} />
    </Card>
  )
}

type Enrolment = { secret: string; uri: string; qr_svg: string }

function Security({ me }: { me: Me }) {
  const { t } = useTranslation()
  const { refresh } = useAuth()
  const [params] = useSearchParams()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const password = useAction()
  const others = useAction()
  const factor = useAction()
  const link = useAction()
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [code, setCode] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [linkPassword, setLinkPassword] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [asking, setAsking] = useState<'disable' | 'renew' | null>(null)
  // Whether a sign-in provider is set up at all: without one there is nothing to link.
  const [methods, setMethods] = useState<Methods | null>(null)
  useEffect(() => {
    authApi.methods().then(setMethods, () => setMethods(null))
  }, [])
  return (
    <>
      {me.sign_in === 'password' ? (
        <Card icon={KeyRound} title={t('account.password')}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void password.run(async () => {
                await authApi.password(current, next)
                setCurrent('')
                setNext('')
              }, t('account.passwordChanged'))
            }}
          >
            <Input label={t('account.currentPassword')} value={current} onChange={setCurrent} type="password" autoComplete="current-password" />
            <Input label={t('account.newPassword')} value={next} onChange={setNext} type="password" autoComplete="new-password" hint={t('auth.passwordHint')} />
            <Button type="submit" accent busy={password.busy} disabled={!current || !next}>
              {t('account.changePassword')}
            </Button>
            <Feedback problem={password.problem} done={password.done} />
          </form>
        </Card>
      ) : (
        <Card icon={KeyRound} title={t('account.password')} text={t('account.viaProvider')}>
          <span />
        </Card>
      )}

      <Card icon={ShieldCheck} title={t('server.twoFactor')} text={t('account.twoFactorHint')}>
        {me.sign_in !== 'password' ? (
          <p className="text-sm text-mist-400">{t('account.twoFactorProvider')}</p>
        ) : codes ? (
          <div className="space-y-3 rounded-xl border border-accent-500/40 bg-accent-500/10 p-3">
            <p className="text-sm font-semibold text-mist-100">{t('account.codesTitle')}</p>
            <p className="text-xs text-mist-400">{t('account.codesLead')}</p>
            <ol className="grid grid-cols-2 gap-2 rounded-lg bg-ink-950 px-4 py-3 font-mono text-sm text-mist-100">
              {codes.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ol>
            <div className="flex gap-2">
              <Button onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>{t('common.copy')}</Button>
              <Button
                accent
                onClick={() => {
                  setCodes(null)
                  void refresh()
                }}
              >
                {t('account.codesDone')}
              </Button>
            </div>
          </div>
        ) : enrolment ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void factor.run(async () => {
                const result = await api<{ recovery_codes: string[] }>('/api/auth/totp/confirm', { method: 'POST', body: { code: code.trim(), password: confirmPassword } })
                setEnrolment(null)
                setCode('')
                setConfirmPassword('')
                setCodes(result.recovery_codes)
              })
            }}
          >
            <p className="text-sm text-mist-300">{t('account.scan')}</p>
            <div className="flex justify-center">
              <img src={'data:image/svg+xml;utf8,' + encodeURIComponent(enrolment.qr_svg)} alt={t('account.qr')} width={196} height={196} className="rounded-lg" />
            </div>
            <code className="block rounded-lg bg-ink-950 px-3 py-2 font-mono text-xs break-all text-mist-200">{enrolment.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            <Input label={t('auth.code.label')} value={code} onChange={setCode} autoComplete="one-time-code" />
            <Input label={t('auth.password')} value={confirmPassword} onChange={setConfirmPassword} type="password" autoComplete="current-password" />
            <div className="flex gap-2">
              <Button onClick={() => setEnrolment(null)}>{t('common.cancel')}</Button>
              <Button type="submit" accent busy={factor.busy} disabled={code.trim().length !== 6 || !confirmPassword}>
                {t('account.twoFactorConfirm')}
              </Button>
            </div>
          </form>
        ) : asking ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void factor.run(async () => {
                if (asking === 'disable') {
                  await api('/api/auth/totp/disable', { method: 'POST', body: { password: confirmPassword } })
                  await refresh()
                } else {
                  setCodes((await api<{ recovery_codes: string[] }>('/api/auth/totp/recovery', { method: 'POST', body: { password: confirmPassword } })).recovery_codes)
                }
                setAsking(null)
                setConfirmPassword('')
              })
            }}
          >
            <p className="text-sm text-mist-300">{asking === 'disable' ? t('account.twoFactorDisableText') : t('account.twoFactorRenewText')}</p>
            <Input label={t('auth.password')} value={confirmPassword} onChange={setConfirmPassword} type="password" autoComplete="current-password" />
            <div className="flex gap-2">
              <Button onClick={() => setAsking(null)}>{t('common.cancel')}</Button>
              <Button type="submit" danger={asking === 'disable'} accent={asking !== 'disable'} busy={factor.busy} disabled={!confirmPassword}>
                {asking === 'disable' ? t('account.twoFactorDisable') : t('account.twoFactorRenew')}
              </Button>
            </div>
          </form>
        ) : me.two_factor ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5 text-mist-200">
              <ShieldCheck className="h-4 w-4 text-ok-500" />
              {t('account.twoFactorOn', { count: me.two_factor_recovery_left })}
            </span>
            <Button onClick={() => setAsking('renew')}>{t('account.twoFactorRenew')}</Button>
            <Button danger onClick={() => setAsking('disable')}>
              {t('account.twoFactorDisable')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-mist-400">{t('account.twoFactorOff')}</span>
            <Button accent busy={factor.busy} onClick={() => void factor.run(async () => setEnrolment(await api<Enrolment>('/api/auth/totp/begin', { method: 'POST' })))}>
              {t('account.twoFactorSetup')}
            </Button>
          </div>
        )}
        <Feedback problem={factor.problem} />
      </Card>

      {(methods?.oidc || me.sign_in === 'oidc' || me.oidc_linked) && (
        <Card icon={Shield} title={t('account.oidc.title', { name: methods?.oidc_name || 'OIDC' })} text={t('account.oidc.lead')}>
          {me.sign_in === 'oidc' ? (
            <p className="text-sm text-mist-400">{t('account.oidc.only')}</p>
          ) : me.oidc_linked ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-mist-400">{t('account.oidc.linked')}</span>
              <Button small busy={link.busy} onClick={() => void link.run(async () => {
                await api('/api/oidc/link', { method: 'DELETE' })
                await refresh()
              }, t('account.oidc.unlinked'))}>
                {t('account.oidc.unlink')}
              </Button>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                void link.run(async () => {
                  const { url } = await api<{ url: string }>('/api/oidc/link/start', { method: 'POST', body: { password: linkPassword } })
                  window.location.assign(url)
                })
              }}
            >
              <p className="text-sm text-mist-400">{t('account.oidc.text')}</p>
              <Input label={t('auth.password')} value={linkPassword} onChange={setLinkPassword} type="password" autoComplete="current-password" />
              <Button type="submit" busy={link.busy} disabled={!linkPassword}>
                {t('account.oidc.link')}
              </Button>
            </form>
          )}
          <Feedback problem={link.problem ?? params.get('error')} done={link.done ?? (params.get('linked') ? t('account.oidc.linkedNow') : null)} />
        </Card>
      )}

      <Card icon={Lock} title={t('account.sessions')} text={t('account.sessionsHint')}>
        <div>
          <Button busy={others.busy} onClick={() => void others.run(() => api('/api/auth/logout-all', { method: 'POST' }), t('account.othersSignedOut'))}>
            <LogOut className="h-4 w-4" strokeWidth={1.8} />
            {t('account.signOutOthers')}
          </Button>
        </div>
        <Feedback problem={others.problem} done={others.done} />
      </Card>
    </>
  )
}
