/**
 * The operator's part of the settings, as in nexlore: accounts, sign-in (password, second factor, OIDC), public
 * pages, uploads, mail, backups, languages, the log and updates. Everything here is the server's; it applies to all.
 */
import { Check, Copy, Download, RotateCcw, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, type Me } from '../../api/client'
import { Avatar } from '../../components/Avatar'
import { forgetAddedLanguages, templateFile } from '../../i18n'
import { useAuth } from '../../state/auth'
import { Button, Card, Confirm, Feedback, Row, saveAsFile, Switch, useAction } from './ui'

export type ServerSettings = {
  public_url: string
  password_login: boolean
  two_factor_required: boolean
  shares_allowed: boolean
  backup_schedule: 'off' | 'daily' | 'weekly'
  backup_keep: number
  smtp_host: string
  smtp_port: number
  smtp_security: 'starttls' | 'tls' | 'none'
  smtp_user: string
  smtp_password_set: boolean
  smtp_from: string
  api_tokens_allowed: boolean
  upload_max_mb: number
  upload_ceiling_mb: number
  strip_location: boolean
  update_check: boolean
}

type Save = (change: Partial<ServerSettings> & { smtp_password?: string }, done?: string) => Promise<void>

// eslint-disable-next-line react-refresh/only-export-components
export function useServerSettings() {
  const [settings, setSettings] = useState<ServerSettings | null>(null)
  const action = useAction()
  useEffect(() => {
    api<ServerSettings>('/api/settings').then(setSettings, () => undefined)
  }, [])
  const save: Save = (change, done) => action.run(async () => setSettings(await api<ServerSettings>('/api/settings', { method: 'PUT', body: change })), done)
  return { settings, save, ...action }
}

function CopyLink({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="flex gap-2">
      <input readOnly value={value} className="nc-field font-mono text-xs" onFocus={(e) => e.target.select()} />
      <button type="button" className="nc-btn nc-btn-ghost shrink-0" onClick={() => void navigator.clipboard?.writeText(value).then(() => setDone(true), () => undefined)}>
        {done ? <Check className="h-4 w-4 text-ok-500" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  )
}

type AccountRow = Me & { spaces: number; locked: boolean; created_at: string; last_seen_at: string | null }

export function AccountsCard() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const [list, setList] = useState<AccountRow[]>([])
  const [link, setLink] = useState<string | null>(null)
  const [asking, setAsking] = useState<{ kind: 'role' | 'delete' | 'password' | 'reset' | 'signout'; account: AccountRow } | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const { busy, problem, done, run } = useAction()
  const load = useCallback(() => {
    api<AccountRow[]>('/api/accounts').then(setList, () => undefined)
  }, [])
  useEffect(load, [load])
  return (
    <Card title={t('server.accounts')} text={t('server.accountsHint')}>
      <ul className="divide-y divide-ink-700/70">
        {list.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <Avatar person={row} className="h-8 w-8 text-sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-mist-100">
                {row.display_name || row.name}
                {row.id === me?.id && <span className="ml-1.5 text-xs text-mist-600">({t('members.you')})</span>}
              </div>
              <div className="truncate text-xs text-mist-600">
                {row.name} · {row.role === 'operator' ? t('account.operator') : t('server.member')} · {t('server.inSpaces', { count: row.spaces })}
                {row.two_factor ? ' · ' + t('server.withTwoFactor') : ''}
                {row.locked ? ' · ' + t('server.locked') : ''}
              </div>
            </div>
            {row.id !== me?.id && (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className="rounded-full border border-ink-700 px-2.5 py-1 text-xs text-mist-300 hover:bg-ink-800" onClick={() => setAsking({ kind: 'role', account: row })}>
                  {row.role === 'operator' ? t('server.makeMember') : t('server.makeOperator')}
                </button>
                {row.sign_in === 'password' && (
                  <button type="button" className="rounded-full border border-ink-700 px-2.5 py-1 text-xs text-mist-300 hover:bg-ink-800" onClick={() => setAsking({ kind: 'password', account: row })}>
                    {t('server.newPassword')}
                  </button>
                )}
                {row.two_factor && (
                  <button type="button" className="rounded-full border border-ink-700 px-2.5 py-1 text-xs text-mist-300 hover:bg-ink-800" onClick={() => setAsking({ kind: 'reset', account: row })}>
                    {t('server.resetTwoFactor')}
                  </button>
                )}
                <button type="button" className="rounded-full border border-ink-700 px-2.5 py-1 text-xs text-mist-300 hover:bg-ink-800" onClick={() => setAsking({ kind: 'signout', account: row })}>
                  {t('server.signOutEverywhere')}
                </button>
                <button type="button" className="rounded-full border border-bad-500/40 px-2.5 py-1 text-xs text-bad-500 hover:bg-bad-500/10" onClick={() => setAsking({ kind: 'delete', account: row })}>
                  {t('server.deleteAccount')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button accent busy={busy} onClick={() => void run(async () => setLink((await api<{ link: string }>('/api/invites', { method: 'POST', body: { days: 7 } })).link))}>
          {t('server.invite')}
        </Button>
        <span className="text-xs text-mist-600">{t('server.inviteHint')}</span>
      </div>
      {link && <CopyLink value={link} />}
      <Feedback problem={problem} done={done} />
      {asking && (
        <Confirm
          title={t(`server.confirm.${asking.kind}.title`, { name: asking.account.name })}
          text={t(`server.confirm.${asking.kind}.text`, { name: asking.account.name })}
          confirm={t(`server.confirm.${asking.kind}.button`)}
          danger={asking.kind === 'delete'}
          password={me?.sign_in === 'password' && asking.kind !== 'signout'}
          onCancel={() => setAsking(null)}
          onConfirm={async (password) => {
            const id = asking.account.id
            if (asking.kind === 'role') await api(`/api/accounts/${id}/role`, { method: 'PUT', body: { role: asking.account.role === 'operator' ? 'member' : 'operator', current_password: password } })
            if (asking.kind === 'delete') await api(`/api/accounts/${id}`, { method: 'DELETE', body: { current_password: password } })
            if (asking.kind === 'reset') await api(`/api/accounts/${id}/totp/reset`, { method: 'POST', body: { current_password: password } })
            if (asking.kind === 'signout') await api(`/api/accounts/${id}/sign-out`, { method: 'POST' })
            if (asking.kind === 'password') {
              const fresh = newPassword || Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('')
              await api(`/api/accounts/${id}/password`, { method: 'PUT', body: { password: fresh, current_password: password } })
              setNewPassword(fresh)
              setAsking(null)
              return
            }
            setAsking(null)
            load()
          }}
        />
      )}
      {newPassword && !asking && (
        <p className="text-sm text-mist-300">
          {t('server.passwordGiven')} <code className="rounded bg-ink-950 px-1.5 py-0.5 font-mono">{newPassword}</code>
        </p>
      )}
    </Card>
  )
}

type Oidc = { configured: boolean; issuer: string; client_id: string; provider_name: string; auto_create: boolean; redirect_uri: string }

export function SignInCard({ server }: { server: ReturnType<typeof useServerSettings> }) {
  const { t } = useTranslation()
  const [oidc, setOidc] = useState<Oidc | null>(null)
  const [secret, setSecret] = useState('')
  const action = useAction()
  useEffect(() => {
    api<Oidc>('/api/oidc/config').then(setOidc, () => undefined)
  }, [])
  const s = server.settings
  if (!s) return null
  return (
    <>
      <Card title={t('server.signin')}>
        <Switch label={t('server.passwordLogin')} hint={t('server.passwordLoginHint')} on={s.password_login} onChange={(on) => void server.save({ password_login: on })} />
        <Switch label={t('server.twoFactorRequired')} hint={t('server.twoFactorRequiredHint')} on={s.two_factor_required} onChange={(on) => void server.save({ two_factor_required: on })} />
        <Feedback problem={server.problem} done={server.done} />
      </Card>
      {oidc && (
        <Card title={t('server.oidc')} text={t('server.oidcHint')}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void action.run(async () => {
                setOidc(await api<Oidc>('/api/oidc/config', { method: 'PUT', body: { issuer: oidc.issuer, client_id: oidc.client_id, client_secret: secret, provider_name: oidc.provider_name, auto_create: oidc.auto_create } }))
                setSecret('')
              }, t('settings.saved'))
            }}
          >
            <Row label={t('server.oidcName')}>
              <input className="nc-field" value={oidc.provider_name} onChange={(e) => setOidc({ ...oidc, provider_name: e.target.value })} placeholder="authentik" />
            </Row>
            <Row label={t('server.oidcIssuer')}>
              <input className="nc-field" value={oidc.issuer} onChange={(e) => setOidc({ ...oidc, issuer: e.target.value })} placeholder="https://auth.example.com/application/o/nexcanvas/" />
            </Row>
            <Row label="Client ID">
              <input className="nc-field" value={oidc.client_id} onChange={(e) => setOidc({ ...oidc, client_id: e.target.value })} />
            </Row>
            <Row label="Client Secret" hint={oidc.configured ? t('server.secretKept') : undefined}>
              <input className="nc-field" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" />
            </Row>
            <Row label={t('server.redirect')} hint={t('server.redirectHint')}>
              <CopyLink value={oidc.redirect_uri} />
            </Row>
            <Switch label={t('server.oidcAutoCreate')} hint={t('server.oidcAutoCreateHint')} on={oidc.auto_create} onChange={(on) => setOidc({ ...oidc, auto_create: on })} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" accent busy={action.busy}>
                {t('common.save')}
              </Button>
              {oidc.configured && (
                <Button
                  danger
                  busy={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await api('/api/oidc/config', { method: 'DELETE' })
                      setOidc(await api<Oidc>('/api/oidc/config'))
                    })
                  }
                >
                  {t('server.oidcRemove')}
                </Button>
              )}
            </div>
            <Feedback problem={action.problem} done={action.done} />
          </form>
        </Card>
      )}
    </>
  )
}

export function PublicCard({ server }: { server: ReturnType<typeof useServerSettings> }) {
  const { t } = useTranslation()
  const s = server.settings
  const [address, setAddress] = useState<string | null>(null)
  if (!s) return null
  return (
    <Card title={t('server.public')} text={t('server.publicHint')}>
      <Switch label={t('server.publicAllowed')} on={s.shares_allowed} onChange={(on) => void server.save({ shares_allowed: on })} />
      <Row label={t('server.publicUrl')} hint={t('server.publicUrlHint')}>
        <div className="flex gap-2">
          <input className="nc-field" value={address ?? s.public_url} onChange={(e) => setAddress(e.target.value)} placeholder="https://boards.example.com" />
          <Button onClick={() => void server.save({ public_url: (address ?? s.public_url).trim() }, t('settings.saved'))}>{t('common.save')}</Button>
        </div>
      </Row>
      <Feedback problem={server.problem} done={server.done} />
    </Card>
  )
}

export function UploadsCard({ server }: { server: ReturnType<typeof useServerSettings> }) {
  const { t } = useTranslation()
  const s = server.settings
  const [limit, setLimit] = useState<string | null>(null)
  if (!s) return null
  return (
    <Card title={t('server.uploads')} text={t('server.uploadsHint')}>
      <Row label={t('server.uploadMax')} hint={t('server.uploadCeiling', { mb: s.upload_ceiling_mb })}>
        <div className="flex gap-2">
          <input className="nc-field w-28" type="number" min={1} max={s.upload_ceiling_mb} value={limit ?? String(s.upload_max_mb)} onChange={(e) => setLimit(e.target.value)} />
          <Button onClick={() => void server.save({ upload_max_mb: Math.max(1, Number(limit ?? s.upload_max_mb)) }, t('settings.saved'))}>{t('common.save')}</Button>
        </div>
      </Row>
      <Switch label={t('server.stripLocation')} hint={t('server.stripLocationHint')} on={s.strip_location} onChange={(on) => void server.save({ strip_location: on })} />
      <Feedback problem={server.problem} done={server.done} />
    </Card>
  )
}

export function MailCard({ server }: { server: ReturnType<typeof useServerSettings> }) {
  const { t } = useTranslation()
  const s = server.settings
  const [draft, setDraft] = useState<Partial<ServerSettings> & { smtp_password?: string }>({})
  const [to, setTo] = useState('')
  const test = useAction()
  if (!s) return null
  const value = { ...s, ...draft }
  return (
    <Card title={t('server.mail')} text={t('server.mailHint')}>
      <Row label={t('server.smtpHost')}>
        <div className="flex gap-2">
          <input className="nc-field" value={value.smtp_host} onChange={(e) => setDraft({ ...draft, smtp_host: e.target.value })} placeholder="smtp.example.com" />
          <input className="nc-field w-24" type="number" value={value.smtp_port} onChange={(e) => setDraft({ ...draft, smtp_port: Number(e.target.value) })} />
        </div>
      </Row>
      <Row label={t('server.smtpSecurity')}>
        <select className="nc-field" value={value.smtp_security} onChange={(e) => setDraft({ ...draft, smtp_security: e.target.value as ServerSettings['smtp_security'] })}>
          <option value="starttls">STARTTLS</option>
          <option value="tls">TLS</option>
          <option value="none">{t('server.none')}</option>
        </select>
      </Row>
      <Row label={t('server.smtpUser')}>
        <input className="nc-field" value={value.smtp_user} onChange={(e) => setDraft({ ...draft, smtp_user: e.target.value })} autoComplete="off" />
      </Row>
      <Row label={t('auth.password')} hint={s.smtp_password_set ? t('server.secretKept') : undefined}>
        <input className="nc-field" type="password" value={draft.smtp_password ?? ''} onChange={(e) => setDraft({ ...draft, smtp_password: e.target.value })} autoComplete="new-password" />
      </Row>
      <Row label={t('server.smtpFrom')}>
        <input className="nc-field" value={value.smtp_from} onChange={(e) => setDraft({ ...draft, smtp_from: e.target.value })} placeholder="boards@example.com" />
      </Row>
      <div className="flex flex-wrap gap-2">
        <Button accent busy={server.busy} onClick={() => void server.save(draft, t('settings.saved')).then(() => setDraft({}))}>
          {t('common.save')}
        </Button>
      </div>
      <Feedback problem={server.problem} done={server.done} />
      <Row label={t('server.mailTest')}>
        <div className="flex gap-2">
          <input className="nc-field" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" />
          <Button busy={test.busy} onClick={() => void test.run(() => api('/api/settings/mail-test', { method: 'POST', body: { to } }), t('server.mailSent'))}>
            {t('server.send')}
          </Button>
        </div>
      </Row>
      <Feedback problem={test.problem} done={test.done} />
    </Card>
  )
}

type Backup = { name: string; size: number; created: string; kind: string; note: string; boards: number; files: number; version: string }
type Brief = { usable: boolean; boards: number; files: number; would_add: number; would_change: number; would_remove: number; damaged: string[]; created: string }

export function BackupsCard({ server }: { server: ReturnType<typeof useServerSettings> }) {
  const { t, i18n } = useTranslation()
  const { me } = useAuth()
  const [list, setList] = useState<Backup[]>([])
  const [brief, setBrief] = useState<(Brief & { name: string }) | null>(null)
  const [asking, setAsking] = useState<{ kind: 'restore' | 'download' | 'delete'; name: string } | null>(null)
  const [restarting, setRestarting] = useState(false)
  const action = useAction()
  const load = useCallback(() => {
    api<Backup[]>('/api/backups').then(setList, () => undefined)
  }, [])
  useEffect(load, [load])
  const s = server.settings
  if (!s) return null
  const size = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
  return (
    <Card title={t('server.backups')} text={t('server.backupsHint')}>
      <Row label={t('server.schedule')}>
        <select className="nc-field" value={s.backup_schedule} onChange={(e) => void server.save({ backup_schedule: e.target.value as ServerSettings['backup_schedule'] })}>
          <option value="off">{t('server.off')}</option>
          <option value="daily">{t('server.daily')}</option>
          <option value="weekly">{t('server.weekly')}</option>
        </select>
      </Row>
      <Row label={t('server.keep')}>
        <input className="nc-field w-24" type="number" min={1} max={100} defaultValue={s.backup_keep} onBlur={(e) => void server.save({ backup_keep: Math.max(1, Math.min(100, Number(e.target.value) || 7)) })} />
      </Row>
      <div className="flex flex-wrap gap-2">
        <Button accent busy={action.busy} onClick={() => void action.run(async () => {
          await api('/api/backups', { method: 'POST', body: { note: '' } })
          load()
        }, t('server.backupMade'))}>
          {t('server.backupNow')}
        </Button>
      </div>
      <ul className="divide-y divide-ink-700/70 rounded-xl border border-ink-700 text-sm">
        {list.length === 0 && <li className="px-3 py-2.5 text-mist-600">{t('server.noBackups')}</li>}
        {list.map((entry) => (
          <li key={entry.name} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-mist-200">{new Date(entry.created).toLocaleString(i18n.language)}</div>
              <div className="text-xs text-mist-600">
                {t(`server.kinds.${entry.kind}`)} · {t('server.backupContent', { boards: entry.boards, files: entry.files })} · {size(entry.size)} · {entry.version}
              </div>
            </div>
            <button type="button" className="rounded p-1.5 text-mist-500 hover:bg-ink-800 hover:text-mist-100" title={t('server.check')} aria-label={t('server.check')} onClick={() => void action.run(async () => setBrief({ ...(await api<Brief>(`/api/backups/${entry.name}/check`, { method: 'POST' })), name: entry.name }))}>
              <ShieldCheck className="h-4 w-4" />
            </button>
            <button type="button" className="rounded p-1.5 text-mist-500 hover:bg-ink-800 hover:text-mist-100" title={t('server.download')} aria-label={t('server.download')} onClick={() => setAsking({ kind: 'download', name: entry.name })}>
              <Download className="h-4 w-4" />
            </button>
            <button type="button" className="rounded p-1.5 text-mist-500 hover:bg-ink-800 hover:text-mist-100" title={t('server.restore')} aria-label={t('server.restore')} onClick={() => setAsking({ kind: 'restore', name: entry.name })}>
              <RotateCcw className="h-4 w-4" />
            </button>
            <button type="button" className="rounded p-1.5 text-mist-500 hover:bg-ink-800 hover:text-bad-500" title={t('server.deleteBackup')} aria-label={t('server.deleteBackup')} onClick={() => setAsking({ kind: 'delete', name: entry.name })}>
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      {brief && (
        <div className={'rounded-xl border px-3 py-2.5 text-sm ' + (brief.usable ? 'border-ok-500/40 bg-ok-500/10 text-mist-200' : 'border-bad-500/40 bg-bad-500/10 text-bad-500')}>
          {brief.usable ? t('server.checkOk', { boards: brief.boards, files: brief.files, add: brief.would_add, remove: brief.would_remove }) : t('server.checkBad')}
        </div>
      )}
      {restarting && <p className="rounded-xl border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-sm text-warn-500">{t('server.restarting')}</p>}
      <Feedback problem={action.problem} done={action.done} />
      {asking && (
        <Confirm
          title={t(`server.confirm.backup_${asking.kind}.title`)}
          text={t(`server.confirm.backup_${asking.kind}.text`)}
          confirm={t(`server.confirm.backup_${asking.kind}.button`)}
          danger={asking.kind !== 'download'}
          password={me?.sign_in === 'password'}
          onCancel={() => setAsking(null)}
          onConfirm={async (password) => {
            if (asking.kind === 'download') {
              const blob = await api<Blob>(`/api/backups/${asking.name}/download`, { method: 'POST', body: { password }, blob: true })
              saveAsFile(asking.name, blob)
            }
            if (asking.kind === 'delete') {
              await api(`/api/backups/${asking.name}`, { method: 'DELETE', body: { password } })
              load()
            }
            if (asking.kind === 'restore') {
              await api(`/api/backups/${asking.name}/restore`, { method: 'POST', body: { password } })
              setRestarting(true)
              window.setTimeout(() => window.location.reload(), 8000)
            }
            setAsking(null)
          }}
        />
      )}
    </Card>
  )
}

type Locale = { code: string; name: string; keys: number }

export function LanguagesCard() {
  const { t } = useTranslation()
  const [list, setList] = useState<Locale[]>([])
  const [code, setCode] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const action = useAction()
  const load = useCallback(() => {
    api<Locale[]>('/api/locales').then(setList, () => undefined)
  }, [])
  useEffect(load, [load])
  const template = () => saveAsFile('nexcanvas-language-template.json', templateFile())
  return (
    <Card title={t('server.languages')} text={t('server.languagesHint')}>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-ink-700 px-3 py-1 text-xs text-mist-300">Deutsch · {t('server.builtIn')}</span>
        <span className="rounded-full border border-ink-700 px-3 py-1 text-xs text-mist-300">English · {t('server.builtIn')}</span>
        {list.map((entry) => (
          <span key={entry.code} className="flex items-center gap-1.5 rounded-full border border-accent-500/40 px-3 py-1 text-xs text-mist-200">
            {entry.name} ({entry.code}) · {t('server.texts', { count: entry.keys })}
            <button type="button" aria-label={t('server.remove')} className="text-mist-500 hover:text-bad-500" onClick={() => void action.run(async () => {
              await api(`/api/locales/${entry.code}`, { method: 'DELETE' })
              forgetAddedLanguages()
              load()
            })}>
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={template}>
          <Download className="h-4 w-4" />
          {t('server.template')}
        </Button>
        <input className="nc-field w-24" value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="es" aria-label={t('server.languageCode')} />
        <Button disabled={!code} busy={action.busy} onClick={() => file.current?.click()}>
          <Upload className="h-4 w-4" />
          {t('server.upload')}
        </Button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const chosen = e.target.files?.[0]
            e.target.value = ''
            if (!chosen) return
            void action.run(async () => {
              await api(`/api/locales/${encodeURIComponent(code)}`, { method: 'PUT', raw: chosen })
              forgetAddedLanguages()
              load()
            }, t('server.languageAdded'))
          }}
        />
      </div>
      <Feedback problem={action.problem} done={action.done} />
    </Card>
  )
}

type LogLine = { time: string; level: string; logger: string; message: string }
type LogMode = { mode: string; until: string | null; fixed_by_env: boolean; modes: string[] }

export function LogCard() {
  const { t } = useTranslation()
  const [lines, setLines] = useState<LogLine[] | null>(null)
  const [level, setLevel] = useState('')
  const [words, setWords] = useState('')
  const [mode, setMode] = useState<LogMode | null>(null)
  const [clearing, setClearing] = useState(false)
  const action = useAction()
  const load = useCallback(() => {
    api<LogLine[]>('/api/logs', { query: { level: level || undefined, search: words.trim() || undefined, limit: 300 } }).then(setLines, () => undefined)
  }, [level, words])
  useEffect(() => {
    const timer = window.setTimeout(load, 250)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(() => {
    api<LogMode>('/api/logs/level').then(setMode, () => undefined)
  }, [])
  const tone = (line: LogLine) => (line.level === 'ERROR' || line.level === 'CRITICAL' ? 'text-bad-500' : line.level === 'WARNING' ? 'text-warn-500' : 'text-mist-300')
  return (
    <Card title={t('server.log')} text={t('server.logHint')}>
      <div className="flex flex-wrap items-end gap-3">
        <select className="nc-field w-36" value={level} onChange={(e) => setLevel(e.target.value)} aria-label={t('server.level')}>
          <option value="">{t('server.allLevels')}</option>
          <option value="INFO">INFO</option>
          <option value="WARNING">WARNING</option>
          <option value="ERROR">ERROR</option>
        </select>
        <input className="nc-field min-w-40 flex-1" value={words} onChange={(e) => setWords(e.target.value)} placeholder={t('server.logSearch')} />
        <Button onClick={load}>{t('server.refresh')}</Button>
      </div>
      <div className="nc-scroll max-h-[28rem] overflow-auto rounded-xl border border-ink-700 bg-ink-950 p-3 font-mono text-[11px] leading-5" role="log">
        {lines?.length === 0 && <p className="text-mist-500">{t('server.logEmpty')}</p>}
        {lines?.map((line, index) => (
          <div key={index} className={'break-words whitespace-pre-wrap ' + tone(line)}>
            <span className="text-mist-600">{line.time}</span> {line.level} <span className="text-mist-500">{line.logger}</span> {line.message}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {mode && (
          <select
            className="nc-field w-56"
            value={mode.mode}
            disabled={mode.fixed_by_env}
            aria-label={t('server.level')}
            onChange={(e) => void action.run(async () => setMode(await api<LogMode>('/api/logs/level', { method: 'PUT', body: { mode: e.target.value, minutes: e.target.value === 'detailed' || e.target.value === 'trace' ? 60 : 0 } })))}
          >
            {mode.modes.map((value) => (
              <option key={value} value={value}>
                {t(`server.levels.${value}`)}
              </option>
            ))}
          </select>
        )}
        <a href="/api/logs/download" className="nc-btn nc-btn-ghost">
          <Download className="h-4 w-4" />
          {t('server.download')}
        </a>
        <Button danger onClick={() => setClearing(true)}>
          {t('server.logClear')}
        </Button>
      </div>
      {mode?.until && <p className="text-xs text-mist-500">{t('server.logUntil', { time: new Date(mode.until).toLocaleTimeString() })}</p>}
      <Feedback problem={action.problem} done={action.done} />
      {clearing && (
        <Confirm
          title={t('server.logClear')}
          text={t('server.logClearText')}
          confirm={t('server.logClear')}
          danger
          onCancel={() => setClearing(false)}
          onConfirm={async () => {
            await api('/api/logs', { method: 'DELETE' })
            setClearing(false)
            setLines([])
          }}
        />
      )}
    </Card>
  )
}

type Updates = { update_check: boolean; checked: boolean; latest: string | null; newer: boolean; release_url: string | null }

export function AboutCard() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const [updates, setUpdates] = useState<Updates | null>(null)
  const action = useAction()
  useEffect(() => {
    api<Updates>('/api/about/updates').then(setUpdates, () => undefined)
  }, [])
  return (
    <Card title={t('server.about')} text={t('server.aboutText', { version: me?.version ?? '' })}>
      {updates && (
        <>
          <Switch label={t('server.updateCheck')} hint={t('server.updateCheckHint')} on={updates.update_check} onChange={(on) => void action.run(async () => setUpdates(await api<Updates>('/api/about/updates', { method: 'PUT', body: { update_check: on } })))} />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-mist-400">
              {updates.newer ? t('server.updateNewer', { version: updates.latest }) : updates.checked ? t('server.updateNone') : t('server.updateUnknown')}
            </span>
            <Button busy={action.busy} onClick={() => void action.run(async () => setUpdates(await api<Updates>('/api/about/updates/check', { method: 'POST' })))}>
              {t('server.updateNow')}
            </Button>
          </div>
        </>
      )}
      <Feedback problem={action.problem} done={action.done} />
    </Card>
  )
}
