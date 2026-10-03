/**
 * The operator's part of the settings, as in nexlore: accounts (with every space and the invitation mail), sign-in
 * (password, second factor, public address, OIDC and authentik), public pages, files, backups, languages and the
 * log. Everything here is the server's; it applies to all.
 */
import { Box, Download, Files, Globe, History, Info, KeyRound, Mail, RotateCcw, ShieldCheck, Trash2, Upload, Users } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, apiTokensApi, type AnyApiToken, type Me, type SpaceInfo } from '../../api/client'
import { Avatar } from '../../components/Avatar'
import { MembersDialog } from '../../components/MembersDialog'
import { forgetAddedLanguages, templateFile } from '../../i18n'
import { useAuth } from '../../state/auth'
import { Button, Card, Confirm, CopyLink, Feedback, Input, saveAsFile, Select, SubHead, Toggle, useAction } from './ui'

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

type Change = Partial<ServerSettings> & { smtp_password?: string }
type Server = ReturnType<typeof useServerSettings>

// eslint-disable-next-line react-refresh/only-export-components
export function useServerSettings() {
  const [settings, setSettings] = useState<ServerSettings | null>(null)
  const action = useAction()
  useEffect(() => {
    api<ServerSettings>('/api/settings').then(setSettings, () => undefined)
  }, [])
  /** The switch moves at once; the server's answer confirms it, a refusal puts it back. */
  const save = async (change: Change, done?: string) => {
    const before = settings
    if (settings) setSettings({ ...settings, ...change })
    const ok = await action.run(async () => setSettings(await api<ServerSettings>('/api/settings', { method: 'PUT', body: change })), done)
    if (!ok) setSettings(before)
  }
  return { settings, save, ...action }
}

type AccountRow = Me & { spaces: number; locked: boolean; created_at: string; last_seen_at: string | null }
type OpenInvite = { id: number; email: string; expires_at: string }
const DAYS = ['1', '7', '30'] as const

export function AccountsCard() {
  const { t, i18n } = useTranslation()
  const { me } = useAuth()
  const [list, setList] = useState<AccountRow[]>([])
  // Inviting into nexcanvas without a space, as nexlore's: how long, to which address, and the open invitations.
  const [days, setDays] = useState<(typeof DAYS)[number]>('7')
  const [email, setEmail] = useState('')
  const [send, setSend] = useState(false)
  const [made, setMade] = useState<{ link: string; sent: boolean; email: string } | null>(null)
  const [invites, setInvites] = useState<OpenInvite[]>([])
  const [asking, setAsking] = useState<{ kind: 'role' | 'delete' | 'password' | 'reset' | 'signout'; account: AccountRow } | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const { busy, problem, done, run } = useAction()
  const load = useCallback(() => {
    api<AccountRow[]>('/api/accounts').then(setList, () => undefined)
    api<OpenInvite[]>('/api/invites').then(setInvites, () => undefined)
  }, [])
  useEffect(load, [load])
  return (
    <Card id="accounts" icon={Users} title={t('server.accounts')} text={t('server.accountsHint')}>
      <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700">
        {list.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar person={row} className="h-8 w-8 text-sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-mist-100">
                {row.display_name || row.name}
                {row.display_name && <span className="ml-1 text-xs font-normal text-mist-500">@{row.name}</span>}
                {row.id === me?.id && <span className="ml-1.5 text-xs font-normal text-mist-500">{t('members.you')}</span>}
              </div>
              <div className="truncate text-xs text-mist-500">
                {row.role === 'operator' ? t('account.operator') : t('server.member')} · {t(`server.signInBy.${row.sign_in}`)} · {t('server.inSpaces', { count: row.spaces })}
                {row.two_factor ? ' · ' + t('server.withTwoFactor') : ''}
                {row.locked ? ' · ' + t('server.locked') : ''}
              </div>
            </div>
            {row.id !== me?.id && (
              <div className="flex flex-wrap gap-1.5">
                <Button small onClick={() => setAsking({ kind: 'role', account: row })}>
                  {row.role === 'operator' ? t('server.makeMember') : t('server.makeOperator')}
                </Button>
                {row.sign_in === 'password' && (
                  <Button small onClick={() => setAsking({ kind: 'password', account: row })}>
                    {t('server.newPassword')}
                  </Button>
                )}
                {row.two_factor && (
                  <Button small onClick={() => setAsking({ kind: 'reset', account: row })}>
                    {t('server.resetTwoFactor')}
                  </Button>
                )}
                <Button small onClick={() => setAsking({ kind: 'signout', account: row })}>
                  {t('server.signOutEverywhere')}
                </Button>
                <Button small danger onClick={() => setAsking({ kind: 'delete', account: row })}>
                  {t('server.deleteAccount')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div>
        <h3 className="mt-2 text-sm font-semibold text-mist-100">{t('server.inviteTitle')}</h3>
        <p className="text-xs text-mist-500">{t('server.inviteText')}</p>
        <form
          className="mt-2 grid gap-2 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault()
            void run(async () => {
              setMade(await api<{ link: string; sent: boolean; email: string }>('/api/invites', { method: 'POST', body: { days: Number(days), email: email.trim(), send } }))
              load()
            })
          }}
        >
          <Select label={t('invite.valid')} value={days} options={DAYS.map((value) => ({ value, label: t('invite.days', { count: Number(value) }) }))} onChange={setDays} />
          <Input label={t('invite.email')} value={email} onChange={setEmail} type="email" className="sm:col-span-2" hint={me?.mail ? undefined : t('invite.noMail')} />
          {me?.mail && (
            <label className="flex items-center gap-2 text-xs text-mist-400 sm:col-span-3">
              <input type="checkbox" checked={send} onChange={(event) => setSend(event.target.checked)} className="accent-accent-500" />
              {t('invite.send')}
            </label>
          )}
          <div className="sm:col-span-3">
            <Button type="submit" accent busy={busy}>
              {t('invite.create')}
            </Button>
          </div>
        </form>
        {made && (
          <div className="mt-3 space-y-1">
            <CopyLink value={made.link} label={t('invite.copy')} />
            <p className="text-xs text-mist-500">{made.sent ? t('invite.sent', { email: made.email }) : t('invite.once')}</p>
          </div>
        )}
        {invites.length > 0 && (
          <ul className="mt-3 divide-y divide-ink-700 rounded-xl border border-ink-700 text-xs" data-testid="open-invites">
            {invites.map((invite) => (
              <li key={invite.id} className="flex items-center gap-3 px-4 py-2 text-mist-300">
                <span className="flex-1">
                  {invite.email || t('invite.noEmail')} · {t('invite.until', { when: new Date(invite.expires_at).toLocaleDateString(i18n.language) })}
                </span>
                <Button
                  small
                  danger
                  busy={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/api/invites/${invite.id}`, { method: 'DELETE' })
                      load()
                    })
                  }
                >
                  {t('invite.withdraw')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
              const fresh = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('')
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

type AdminSpace = { id: number; name: string; members: number; managers: string[]; role: SpaceInfo['role'] }

/** Every space with who manages it, without its contents: the operator resets rights here, as in nexlore. */
export function AllSpacesCard() {
  const { t } = useTranslation()
  const [spaces, setSpaces] = useState<AdminSpace[]>([])
  const [open, setOpen] = useState<AdminSpace | null>(null)
  const { problem, run } = useAction()
  const load = useCallback(() => run(async () => setSpaces(await api<AdminSpace[]>('/api/admin/spaces'))), [run])
  useEffect(() => {
    void load()
  }, [load])
  return (
    <Card id="all-spaces" icon={Box} title={t('server.allSpaces.title')} text={t('server.allSpaces.text')}>
      <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700">
        {spaces.length === 0 && <li className="px-4 py-3 text-sm text-mist-500">{t('server.allSpaces.none')}</li>}
        {spaces.map((space) => (
          <li key={space.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <span className="font-medium text-mist-100">{space.name}</span>
            <span className="text-xs text-mist-500">
              {space.members === 0 ? t('server.allSpaces.yours') : t('server.allSpaces.members', { count: space.members, managers: space.managers.join(', ') || '–' })}
            </span>
            <span className="ml-auto">
              <Button small onClick={() => setOpen(space)}>
                {t('server.allSpaces.rights')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <Feedback problem={problem} />
      {open && (
        <MembersDialog
          space={{ id: open.id, name: open.name, color: '', role: open.role, boards: 0, members: [] }}
          onClose={() => {
            setOpen(null)
            void load()
          }}
        />
      )}
    </Card>
  )
}

type Oidc = { configured: boolean; issuer: string; client_id: string; provider_name: string; auto_create: boolean; redirect_uri: string }
type Steps = { steps: { key: string; ok: boolean; detail: string }[] }

export function SignInCard({ server }: { server: Server }) {
  const { t } = useTranslation()
  const [oidc, setOidc] = useState<Oidc | null>(null)
  const [form, setForm] = useState({ issuer: '', client_id: '', client_secret: '', provider_name: '', auto_create: false })
  const [address, setAddress] = useState<string | null>(null)
  const [authentik, setAuthentik] = useState({ url: '', token: '' })
  const [steps, setSteps] = useState<Steps | null>(null)
  const { busy, problem, done, run } = useAction()

  const loadOidc = useCallback(async () => {
    const config = await api<Oidc>('/api/oidc/config')
    setOidc(config)
    setForm({ issuer: config.issuer, client_id: config.client_id, client_secret: '', provider_name: config.provider_name, auto_create: config.auto_create })
  }, [])
  useEffect(() => {
    void run(loadOidc)
  }, [run, loadOidc])

  const s = server.settings
  if (!s) return null
  return (
    <Card id="sign-in" icon={ShieldCheck} title={t('server.signin')} text={t('server.signinText')}>
      <Toggle label={t('server.passwordLogin')} hint={t('server.passwordLoginHint')} checked={s.password_login} onChange={(password_login) => void server.save({ password_login })} />
      <Toggle label={t('server.twoFactorRequired')} hint={t('server.twoFactorRequiredHint')} checked={s.two_factor_required} onChange={(two_factor_required) => void server.save({ two_factor_required })} />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void server.save({ public_url: (address ?? s.public_url).trim() }, t('settings.saved'))
        }}
      >
        <Input label={t('server.publicUrl')} value={address ?? s.public_url} onChange={setAddress} placeholder="https://boards.example.com" hint={t('server.publicUrlHint')} className="min-w-60 flex-1" />
        <Button type="submit" busy={server.busy}>
          {t('common.save')}
        </Button>
      </form>
      <Feedback problem={server.problem} done={server.done} />

      <SubHead title={t('server.oidc')} text={oidc?.configured ? t('server.oidcOn', { issuer: oidc.issuer }) : t('server.oidcOff')} />
      {oidc && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-mist-400">{t('server.redirect')}</span>
          <CopyLink value={oidc.redirect_uri} label={t('server.redirect')} />
          <span className="block text-xs text-mist-500">{t('server.redirectHint')}</span>
        </div>
      )}
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            setOidc(await api<Oidc>('/api/oidc/config', { method: 'PUT', body: form }))
            setForm((current) => ({ ...current, client_secret: '' }))
          }, t('settings.saved'))
        }}
      >
        <Input label={t('server.oidcIssuer')} value={form.issuer} onChange={(issuer) => setForm({ ...form, issuer })} placeholder="https://auth.example.com/application/o/nexcanvas/" className="sm:col-span-2" />
        <Input label={t('server.clientId')} value={form.client_id} onChange={(client_id) => setForm({ ...form, client_id })} />
        <Input label={t('server.clientSecret')} value={form.client_secret} onChange={(client_secret) => setForm({ ...form, client_secret })} type="password" autoComplete="new-password" placeholder={oidc?.configured ? t('server.secretKept') : ''} />
        <Input label={t('server.oidcName')} value={form.provider_name} onChange={(provider_name) => setForm({ ...form, provider_name })} placeholder="authentik" />
        <div className="sm:col-span-2">
          <Toggle label={t('server.oidcAutoCreate')} hint={t('server.oidcAutoCreateHint')} checked={form.auto_create} onChange={(auto_create) => setForm({ ...form, auto_create })} />
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" accent busy={busy}>
            {t('common.save')}
          </Button>
          {oidc?.configured && (
            <Button
              danger
              busy={busy}
              onClick={() =>
                void run(async () => {
                  await api('/api/oidc/config', { method: 'DELETE' })
                  await loadOidc()
                })
              }
            >
              {t('server.oidcRemove')}
            </Button>
          )}
        </div>
      </form>

      <SubHead title={t('server.authentik.title')} text={t('server.authentik.text')} />
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            setSteps(await api<Steps>('/api/oidc/authentik/setup', { method: 'POST', body: authentik }))
            setAuthentik({ ...authentik, token: '' })
            await loadOidc()
          })
        }}
      >
        <Input label={t('server.authentik.url')} value={authentik.url} onChange={(url) => setAuthentik({ ...authentik, url })} placeholder="https://auth.example.com" />
        <Input label={t('server.authentik.token')} value={authentik.token} onChange={(token) => setAuthentik({ ...authentik, token })} type="password" autoComplete="new-password" />
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" busy={busy} disabled={!authentik.url.trim() || !authentik.token.trim()}>
            {t('server.authentik.run')}
          </Button>
          <a href="/api/oidc/authentik/blueprint" className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 px-3.5 py-1.5 text-sm text-mist-300 hover:bg-ink-850">
            <Download className="h-4 w-4" strokeWidth={1.8} />
            {t('server.authentik.blueprint')}
          </a>
        </div>
      </form>
      {steps && (
        <ol className="space-y-1 text-xs" data-testid="authentik-steps">
          {steps.steps.map((step) => (
            <li key={step.key} className={step.ok ? 'text-ok-500' : 'text-bad-500'}>
              {step.ok ? '✓' : '✗'} {step.detail}
            </li>
          ))}
        </ol>
      )}
      <Feedback problem={problem} done={done} />
    </Card>
  )
}

export function SharesCard({ server }: { server: Server }) {
  const { t } = useTranslation()
  const s = server.settings
  if (!s) return null
  return (
    <Card id="shares" icon={Globe} title={t('server.public')} text={t('server.publicHint')}>
      <Toggle label={t('server.publicAllowed')} hint={t('server.publicAllowedHint')} checked={s.shares_allowed} onChange={(shares_allowed) => void server.save({ shares_allowed })} />
      <Feedback problem={server.problem} done={server.done} />
    </Card>
  )
}

/** The switch for API tokens, and every token there is: who made it, which spaces, when it was used; blocked for good
 * on request (every way out needs a latch). Never the token itself. As nexlore's. */
export function ApiTokensCard({ server }: { server: Server }) {
  const { t, i18n } = useTranslation()
  const { busy, problem, run } = useAction()
  const [tokens, setTokens] = useState<AnyApiToken[] | null>(null)
  const [blocking, setBlocking] = useState<AnyApiToken | null>(null)
  const load = useCallback(() => {
    apiTokensApi.every().then(setTokens, () => setTokens(null))
  }, [])
  useEffect(load, [load])
  const s = server.settings
  if (!s) return null
  return (
    <Card id="api-tokens" icon={KeyRound} title={t('server.apiTokens.title')} text={t('server.apiTokens.text')}>
      <Toggle label={t('server.apiTokens.allow')} hint={t('server.apiTokens.allowHint')} checked={s.api_tokens_allowed} onChange={(api_tokens_allowed) => void server.save({ api_tokens_allowed })} />
      {tokens && tokens.length > 0 && (
        <div className="nc-scroll overflow-x-auto">
          <table className="w-full text-left text-sm text-mist-200" data-testid="admin-api-tokens">
            <thead className="text-xs text-mist-500">
              <tr>
                <th className="py-1.5 pr-3 font-medium">{t('server.apiTokens.account')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('server.apiTokens.token')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('server.apiTokens.spaces')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('server.apiTokens.used')}</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id} className="border-t border-ink-700">
                  <td className="py-1.5 pr-3">{token.account}</td>
                  <td className="py-1.5 pr-3">
                    {token.name} <code className="font-mono text-xs text-mist-500">{token.prefix}…</code>
                  </td>
                  <td className="py-1.5 pr-3">{token.spaces === null ? t('server.apiTokens.allSpaces') : t('server.apiTokens.someSpaces', { count: token.spaces })}</td>
                  <td className="py-1.5 pr-3 text-mist-400">
                    {token.last_used_at ? new Date(token.last_used_at).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' }) : t('apiTokens.unused')}
                  </td>
                  <td className="py-1.5 text-right">
                    {token.blocked ? (
                      <span className="text-xs text-bad-500">{t('server.apiTokens.blocked')}</span>
                    ) : (
                      <Button small danger busy={busy} onClick={() => setBlocking(token)} label={t('server.apiTokens.blockNamed', { name: token.name, account: token.account })}>
                        {t('server.apiTokens.block')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-mist-500">{t('server.apiTokens.offHint')}</p>
      <Feedback problem={problem ?? server.problem} done={server.done} />
      {blocking && (
        <Confirm
          title={t('server.apiTokens.blockTitle', { name: blocking.name, account: blocking.account })}
          text={t('server.apiTokens.blockText')}
          confirm={t('server.apiTokens.block')}
          danger
          onCancel={() => setBlocking(null)}
          onConfirm={async () => {
            await run(async () => {
              await apiTokensApi.block(blocking.id)
              load()
            })
            setBlocking(null)
          }}
        />
      )}
    </Card>
  )
}

export function FilesCard({ server }: { server: Server }) {
  const { t } = useTranslation()
  const s = server.settings
  const [limit, setLimit] = useState<string | null>(null)
  if (!s) return null
  return (
    <Card id="files" icon={Files} title={t('server.files')} text={t('server.filesHint')}>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void server.save({ upload_max_mb: Math.max(1, Math.min(s.upload_ceiling_mb, Number(limit ?? s.upload_max_mb) || 1)) }, t('settings.saved'))
        }}
      >
        <Input label={t('server.uploadMax')} type="number" min={1} max={s.upload_ceiling_mb} value={limit ?? String(s.upload_max_mb)} onChange={setLimit} hint={t('server.uploadCeiling', { mb: s.upload_ceiling_mb })} className="w-56" />
        <Button type="submit" busy={server.busy}>
          {t('common.save')}
        </Button>
      </form>
      <Toggle label={t('server.stripLocation')} hint={t('server.stripLocationHint')} checked={s.strip_location} onChange={(strip_location) => void server.save({ strip_location })} />
      <Feedback problem={server.problem} done={server.done} />
    </Card>
  )
}

export function MailCard({ server }: { server: Server }) {
  const { t } = useTranslation()
  const s = server.settings
  const [draft, setDraft] = useState<Change>({})
  const [to, setTo] = useState('')
  const test = useAction()
  if (!s) return null
  const value = { ...s, ...draft }
  return (
    <Card id="mail" icon={Mail} title={t('server.mail')} text={t('server.mailHint')}>
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          void server.save(draft, t('settings.saved')).then(() => setDraft({}))
        }}
      >
        <Input label={t('server.smtpHost')} value={value.smtp_host} onChange={(smtp_host) => setDraft({ ...draft, smtp_host })} placeholder="smtp.example.com" />
        <Input label={t('server.smtpPort')} type="number" value={String(value.smtp_port)} onChange={(port) => setDraft({ ...draft, smtp_port: Number(port) })} />
        <Select
          label={t('server.smtpSecurity')}
          value={value.smtp_security}
          onChange={(smtp_security) => setDraft({ ...draft, smtp_security })}
          options={[
            { value: 'starttls', label: 'STARTTLS' },
            { value: 'tls', label: 'TLS' },
            { value: 'none', label: t('server.none') },
          ]}
        />
        <Input label={t('server.smtpUser')} value={value.smtp_user} onChange={(smtp_user) => setDraft({ ...draft, smtp_user })} />
        <Input label={t('auth.password')} type="password" autoComplete="new-password" value={draft.smtp_password ?? ''} onChange={(smtp_password) => setDraft({ ...draft, smtp_password })} placeholder={s.smtp_password_set ? t('server.secretKept') : ''} />
        <Input label={t('server.smtpFrom')} value={value.smtp_from} onChange={(smtp_from) => setDraft({ ...draft, smtp_from })} placeholder="boards@example.com" />
        <div className="sm:col-span-2">
          <Button type="submit" accent busy={server.busy}>
            {t('common.save')}
          </Button>
        </div>
      </form>
      <Feedback problem={server.problem} done={server.done} />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void test.run(() => api('/api/settings/mail-test', { method: 'POST', body: { to } }), t('server.mailSent'))
        }}
      >
        <Input label={t('server.mailTest')} value={to} onChange={setTo} placeholder="you@example.com" className="min-w-60 flex-1" />
        <Button type="submit" busy={test.busy} disabled={!to.trim()}>
          {t('server.send')}
        </Button>
      </form>
      <Feedback problem={test.problem} done={test.done} />
    </Card>
  )
}

type Backup = { name: string; size: number; created: string; kind: string; note: string; boards: number; files: number; version: string }
type Brief = { usable: boolean; boards: number; files: number; would_add: number; would_change: number; would_remove: number; damaged: string[]; created: string }

export function BackupsCard({ server }: { server: Server }) {
  const { t, i18n } = useTranslation()
  const { me } = useAuth()
  const [list, setList] = useState<Backup[]>([])
  const [brief, setBrief] = useState<(Brief & { name: string }) | null>(null)
  const [asking, setAsking] = useState<{ kind: 'restore' | 'download' | 'delete'; name: string } | null>(null)
  const [keep, setKeep] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const action = useAction()
  const load = useCallback(() => {
    api<Backup[]>('/api/backups').then(setList, () => undefined)
  }, [])
  useEffect(load, [load])
  const s = server.settings
  if (!s) return null
  const size = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
  const icon = 'rounded-lg p-1.5 text-mist-500 hover:bg-ink-800 hover:text-mist-100'
  return (
    <Card id="backups" icon={History} title={t('server.backups')} text={t('server.backupsHint')}>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          label={t('server.schedule')}
          value={s.backup_schedule}
          onChange={(backup_schedule) => void server.save({ backup_schedule })}
          options={[
            { value: 'off', label: t('server.off') },
            { value: 'daily', label: t('server.daily') },
            { value: 'weekly', label: t('server.weekly') },
          ]}
          className="w-48"
        />
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void server.save({ backup_keep: Math.max(1, Math.min(100, Number(keep ?? s.backup_keep) || 7)) }, t('settings.saved'))
          }}
        >
          <Input label={t('server.keep')} type="number" min={1} max={100} value={keep ?? String(s.backup_keep)} onChange={setKeep} className="w-28" />
          <Button type="submit" busy={server.busy}>
            {t('common.save')}
          </Button>
        </form>
        <span className="ml-auto">
          <Button
            accent
            busy={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api('/api/backups', { method: 'POST', body: { note: '' } })
                load()
              }, t('server.backupMade'))
            }
          >
            {t('server.backupNow')}
          </Button>
        </span>
      </div>
      <Feedback problem={server.problem} done={server.done} />
      <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700 text-sm">
        {list.length === 0 && <li className="px-4 py-3 text-mist-500">{t('server.noBackups')}</li>}
        {list.map((entry) => (
          <li key={entry.name} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-mist-100">{new Date(entry.created).toLocaleString(i18n.language)}</div>
              <div className="text-xs text-mist-500">
                {t(`server.kinds.${entry.kind}`)} · {t('server.backupContent', { boards: entry.boards, files: entry.files })} · {size(entry.size)} · {entry.version}
              </div>
            </div>
            <button type="button" className={icon} title={t('server.check')} aria-label={t('server.check')} onClick={() => void action.run(async () => setBrief({ ...(await api<Brief>(`/api/backups/${entry.name}/check`, { method: 'POST' })), name: entry.name }))}>
              <ShieldCheck className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button type="button" className={icon} title={t('server.download')} aria-label={t('server.download')} onClick={() => setAsking({ kind: 'download', name: entry.name })}>
              <Download className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button type="button" className={icon} title={t('server.restore')} aria-label={t('server.restore')} onClick={() => setAsking({ kind: 'restore', name: entry.name })}>
              <RotateCcw className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button type="button" className="rounded-lg p-1.5 text-mist-500 hover:bg-ink-800 hover:text-bad-500" title={t('server.deleteBackup')} aria-label={t('server.deleteBackup')} onClick={() => setAsking({ kind: 'delete', name: entry.name })}>
              <Trash2 className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </li>
        ))}
      </ul>
      {brief && (
        <div className={'rounded-xl border px-4 py-3 text-sm ' + (brief.usable ? 'border-ok-500/40 bg-ok-500/10 text-mist-200' : 'border-bad-500/40 bg-bad-500/10 text-bad-500')}>
          {brief.usable ? t('server.checkOk', { boards: brief.boards, files: brief.files, add: brief.would_add, remove: brief.would_remove }) : t('server.checkBad')}
        </div>
      )}
      {restarting && <p className="rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3 text-sm text-warn-500">{t('server.restarting')}</p>}
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
  const chip = 'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs'
  return (
    <Card id="languages" icon={Globe} title={t('server.languages')} text={t('server.languagesHint')}>
      <div className="flex flex-wrap gap-2">
        <span className={chip + ' border-ink-700 text-mist-300'}>Deutsch · {t('server.builtIn')}</span>
        <span className={chip + ' border-ink-700 text-mist-300'}>English · {t('server.builtIn')}</span>
        {list.map((entry) => (
          <span key={entry.code} className={chip + ' border-accent-500/40 text-mist-200'}>
            {entry.name} ({entry.code}) · {t('server.texts', { count: entry.keys })}
            <button
              type="button"
              aria-label={t('server.remove')}
              className="text-mist-500 hover:text-bad-500"
              onClick={() =>
                void action.run(async () => {
                  await api(`/api/locales/${entry.code}`, { method: 'DELETE' })
                  forgetAddedLanguages()
                  load()
                })
              }
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button onClick={() => saveAsFile('nexcanvas-language-template.json', templateFile())}>
          <Download className="h-4 w-4" strokeWidth={1.8} />
          {t('server.template')}
        </Button>
        <Input label={t('server.languageCode')} value={code} onChange={(value) => setCode(value.trim())} placeholder="es" className="w-28" />
        <Button disabled={!code} busy={action.busy} onClick={() => file.current?.click()}>
          <Upload className="h-4 w-4" strokeWidth={1.8} />
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
    <Card id="log" icon={Info} title={t('server.log')} text={t('server.logHint')}>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          label={t('server.level')}
          value={level}
          onChange={setLevel}
          options={[
            { value: '', label: t('server.allLevels') },
            { value: 'INFO', label: 'INFO' },
            { value: 'WARNING', label: 'WARNING' },
            { value: 'ERROR', label: 'ERROR' },
          ]}
          className="w-40"
        />
        <Input label={t('server.logSearch')} value={words} onChange={setWords} className="min-w-40 flex-1" />
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
      <div className="flex flex-wrap items-end gap-2">
        {mode && (
          <label className="block text-sm">
            <span className="text-xs font-medium text-mist-400">{t('server.detail')}</span>
            <select
              className="mt-1 h-9 w-56 rounded-lg border border-ink-700 bg-ink-850 px-2 text-sm text-mist-100"
              value={mode.mode}
              disabled={mode.fixed_by_env}
              onChange={(e) => void action.run(async () => setMode(await api<LogMode>('/api/logs/level', { method: 'PUT', body: { mode: e.target.value, minutes: e.target.value === 'detailed' || e.target.value === 'trace' ? 60 : 0 } })))}
            >
              {mode.modes.map((value) => (
                <option key={value} value={value}>
                  {t(`server.levels.${value}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        <a href="/api/logs/download" className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 px-3.5 py-1.5 text-sm text-mist-300 hover:bg-ink-850">
          <Download className="h-4 w-4" strokeWidth={1.8} />
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
