/**
 * Settings and the own account, laid out like nexlore's: whoever knows one finds their way in the other.
 * Settings: General (the own preferences), Spaces, Server (the operator's, in a second row of tabs).
 * Account: Profile, Security.
 */
import { LogOut, RotateCcw, ShieldCheck, Upload, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { api, authApi, type Me, type Preferences } from '../api/client'
import { useBoards, type Space } from '../board/store'
import { Avatar } from '../components/Avatar'
import { MembersDialog } from '../components/MembersDialog'
import { useAuth } from '../state/auth'
import { AboutCard, AccountsCard, BackupsCard, LanguagesCard, LogCard, MailCard, PublicCard, SignInCard, UploadsCard, useServerSettings } from './settings/ServerCards'
import { Button, Card, Feedback, Row, Switch, TabRow, useAction } from './settings/ui'

export function SettingsPage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const [params, setParams] = useSearchParams()
  const operator = me?.role === 'operator'
  const tab = params.get('tab') ?? 'general'
  const sub = params.get('sub') ?? 'accounts'
  const tabs: [string, string][] = [['general', t('settings.general')], ['spaces', t('settings.spaces')]]
  if (operator) tabs.push(['server', t('settings.server')])
  return (
    <main className="nc-scroll min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        <h1 className="text-2xl font-bold tracking-tight text-mist-100">{t('settings.title')}</h1>
        <TabRow tabs={tabs} value={tab} onChange={(v) => setParams({ tab: v })} />
        {tab === 'general' && <General />}
        {tab === 'spaces' && <Spaces />}
        {tab === 'server' && operator && <Server sub={sub} onSub={(v) => setParams({ tab: 'server', sub: v })} />}
      </div>
    </main>
  )
}

function General() {
  const { t } = useTranslation()
  const { me, setMe } = useAuth()
  const action = useAction()
  const preferences = me?.preferences
  if (!me || !preferences) return null
  const change = (patch: Partial<Preferences>) =>
    void action.run(async () => {
      const next = await authApi.preferences(patch)
      setMe({ ...me, preferences: next } as Me)
    })
  return (
    <Card title={t('settings.general')}>
      <Row label={t('settings.startPage')}>
        <select className="nc-field" value={preferences.start} onChange={(e) => change({ start: e.target.value as Preferences['start'] })}>
          <option value="boards">{t('boards.all')}</option>
          <option value="last">{t('settings.lastBoard')}</option>
        </select>
      </Row>
      <Switch label={t('settings.snap')} hint={t('settings.snapHint')} on={preferences.snap} onChange={(on) => change({ snap: on })} />
      <Switch label={t('settings.grid')} on={preferences.dots} onChange={(on) => change({ dots: on })} />
      <Switch label={t('settings.toolBack')} on={preferences.tool_back} onChange={(on) => change({ tool_back: on })} />
      <Feedback problem={action.problem} done={null} />
    </Card>
  )
}

function Spaces() {
  const { t } = useTranslation()
  const boards = useBoards()
  const [members, setMembers] = useState<Space | null>(null)
  const [bin, setBin] = useState<{ id: number; name: string; color: string; deleted_at: string }[]>([])
  const action = useAction()
  useEffect(() => {
    api<{ id: number; name: string; color: string; deleted_at: string }[]>('/api/spaces/bin').then(setBin, () => undefined)
  }, [])
  return (
    <>
      <Card title={t('settings.spaces')} text={t('settings.spacesHint')}>
        {boards.spaces.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-700 px-3 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-sm text-mist-100">{s.name}</span>
            <span className="text-xs text-mist-600">
              {t(`roles.${s.role}`)} · {t('boards.count', { count: s.boards })}
            </span>
            <span className="flex -space-x-1.5">
              {s.members.slice(0, 5).map((m) => (
                <Avatar key={m.id} person={m} className="h-6 w-6 text-[11px]" ring />
              ))}
            </span>
            <button type="button" className="rounded-full border border-ink-700 px-2.5 py-1 text-xs text-mist-300 hover:bg-ink-800" onClick={() => setMembers(s)}>
              <Users className="mr-1 inline h-3.5 w-3.5" />
              {t('share.manage')}
            </button>
          </div>
        ))}
      </Card>
      {bin.length > 0 && (
        <Card title={t('settings.spacesBin')} text={t('settings.spacesBinHint')}>
          {bin.map((s) => (
            <div key={s.id} className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              <span className="flex-1 text-sm text-mist-200">{s.name}</span>
              <Button
                busy={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await api(`/api/spaces/${s.id}/restore`, { method: 'POST' })
                    setBin((list) => list.filter((x) => x.id !== s.id))
                    await boards.refresh()
                  })
                }
              >
                <RotateCcw className="h-4 w-4" />
                {t('files.restore')}
              </Button>
            </div>
          ))}
          <Feedback problem={action.problem} done={null} />
        </Card>
      )}
      {members && <MembersDialog space={members} onClose={() => setMembers(null)} />}
    </>
  )
}

function Server({ sub, onSub }: { sub: string; onSub: (v: string) => void }) {
  const { t } = useTranslation()
  const server = useServerSettings()
  return (
    <div className="space-y-4">
      <TabRow
        small
        tabs={[
          ['accounts', t('server.accounts')],
          ['signin', t('server.signin')],
          ['public', t('server.public')],
          ['uploads', t('server.uploads')],
          ['mail', t('server.mail')],
          ['backups', t('server.backups')],
          ['languages', t('server.languages')],
          ['log', t('server.log')],
          ['about', t('server.about')],
        ]}
        value={sub}
        onChange={onSub}
      />
      {sub === 'accounts' && <AccountsCard />}
      {sub === 'signin' && <SignInCard server={server} />}
      {sub === 'public' && <PublicCard server={server} />}
      {sub === 'uploads' && <UploadsCard server={server} />}
      {sub === 'mail' && <MailCard server={server} />}
      {sub === 'backups' && <BackupsCard server={server} />}
      {sub === 'languages' && <LanguagesCard />}
      {sub === 'log' && <LogCard />}
      {sub === 'about' && <AboutCard />}
    </div>
  )
}

// --- The own account ------------------------------------------------------------------------------------------------

export function AccountPage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'profile'
  if (!me) return null
  return (
    <main className="nc-scroll min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        <h1 className="text-2xl font-bold tracking-tight text-mist-100">{t('account.mine')}</h1>
        <TabRow tabs={[['profile', t('account.profile')], ['security', t('account.security')]]} value={tab} onChange={(v) => setParams({ tab: v })} />
        {tab === 'profile' && <Profile me={me} />}
        {tab === 'security' && <Security me={me} />}
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
    <Card title={t('account.profile')}>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar person={me} className="h-16 w-16 text-2xl" />
        <Button onClick={() => picture.current?.click()} busy={action.busy}>
          <Upload className="h-4 w-4" />
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
      <Row label={t('account.displayName')} hint={t('account.displayNameHint', { name: me.name })}>
        <div className="flex gap-2">
          <input className="nc-field" value={shown} onChange={(e) => setShown(e.target.value)} maxLength={80} />
          <Button accent busy={action.busy} onClick={() => void action.run(async () => setMe(await authApi.profile(shown.trim())), t('settings.saved'))}>
            {t('common.save')}
          </Button>
        </div>
      </Row>
      <Feedback problem={action.problem} done={action.done} />
    </Card>
  )
}

type Enrolment = { secret: string; uri: string; qr_svg: string }

function Security({ me }: { me: Me }) {
  const { t } = useTranslation()
  const { refresh } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const password = useAction()
  const others = useAction()
  const factor = useAction()
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [code, setCode] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [asking, setAsking] = useState<'disable' | 'renew' | null>(null)
  return (
    <>
      {me.sign_in === 'password' ? (
        <Card title={t('account.password')}>
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
            <Row label={t('account.currentPassword')}>
              <input className="nc-field" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </Row>
            <Row label={t('account.newPassword')} hint={t('auth.passwordHint')}>
              <input className="nc-field" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
            </Row>
            <Button type="submit" accent busy={password.busy} disabled={!current || !next}>
              {t('account.changePassword')}
            </Button>
            <Feedback problem={password.problem} done={password.done} />
          </form>
        </Card>
      ) : (
        <Card title={t('account.password')} text={t('account.viaProvider')}>
          <span />
        </Card>
      )}

      <Card title={t('server.twoFactor')} text={t('account.twoFactorHint')}>
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
            <Row label={t('auth.code.label')}>
              <input className="nc-field" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoFocus />
            </Row>
            <Row label={t('auth.password')}>
              <input className="nc-field" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="current-password" />
            </Row>
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
            <input className="nc-field" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="current-password" autoFocus placeholder={t('auth.password')} />
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
        <Feedback problem={factor.problem} done={null} />
      </Card>

      <Card title={t('account.sessions')} text={t('account.sessionsHint')}>
        <div>
          <Button busy={others.busy} onClick={() => void others.run(() => api('/api/auth/logout-all', { method: 'POST' }), t('account.othersSignedOut'))}>
            <LogOut className="h-4 w-4" />
            {t('account.signOutOthers')}
          </Button>
        </div>
        <Feedback problem={others.problem} done={others.done} />
      </Card>
    </>
  )
}
