/**
 * Settings, Server, Sign-in: three cards one below the other, as the shared sign-in blueprint lays them out for every
 * nex app. Order, wording and behaviour come from there; the parts (card, switch, field, button, question)
 * are nexcanvas' own.
 *
 * 1. Sign-in: password sign-in (locked on while no provider is active), the public address, the second factor.
 * 2. Sign-in providers: the list with its marks, the drag handle, and the form as a dialog.
 * 3. authentik in one step: address, token, "Set up", the blueprint, and the steps with the reason of a failure.
 *
 * Coupled, sign-in comes through the coupling: card 1 says so, the list is only shown (the entries set
 * aside with "off"), the authentik card is locked.
 */
import { GripVertical, KeyRound, ShieldCheck, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { ApiError, oidcAdminApi, type AddressQuestion, type AuthentikResult, type OidcProvider, type OidcProviderForm } from '../../api/client'
import { Dialog } from '../../components/Dialog'
import { errorText } from '../../lib/errors'
import { useAuth } from '../../state/auth'
import {
  authentikIssuerChange,
  authentikProposal,
  authentikProxyWarning,
  authentikReasonKey,
  authentikRedirect,
  authentikStale,
  authentikStepKey,
  oidcErrorKey,
  oidcFormErrorKey,
  slugFromLabel,
  type AuthentikAddress,
} from '../../vendor/nexoidc/oidc'
import type { useServerSettings } from './ServerCards'
import { ASKED, Button, Card, Confirm, CopyLink, Feedback, Input, Toggle, useAction } from './ui'

type Server = ReturnType<typeof useServerSettings>

/** The whole part: the list is loaded once and shared, the button changes it too. */
export function SignInPart({ server, connected }: { server: Server; connected: boolean }) {
  const [providers, setProviders] = useState<OidcProvider[] | null>(null)
  const load = useCallback(async () => setProviders(await oidcAdminApi.providers()), [])
  useEffect(() => {
    void load().catch(() => setProviders([]))
  }, [load])
  const active = (providers ?? []).some((entry) => entry.enabled)
  const coupled = connected || (providers ?? []).some((entry) => entry.managed === 'nexsuite')
  const publicUrl = server.settings?.public_url ?? ''
  return (
    <>
      <SignInCard server={server} anyActive={active} coupled={coupled} />
      <ProvidersCard providers={providers} reload={load} publicUrl={publicUrl} />
      <AuthentikCard publicUrl={publicUrl} coupled={coupled} reload={load} onAddress={server.reload} />
    </>
  )
}

// --- Card 1: sign-in -------------------------------------------------------------------------------------------------

export function SignInCard({ server, anyActive, coupled }: { server: Server; anyActive: boolean; coupled: boolean }) {
  const { t } = useTranslation()
  const { me } = useAuth()
  const [address, setAddress] = useState<string | null>(null)
  // The address changes what authentik knows (the button registered the old one): ask before saving.
  const [asking, setAsking] = useState<{ question: AddressQuestion; url: string } | null>(null)
  const s = server.settings
  if (!s) return null
  const trusts = { trusts: t('oidc.admin.trustsSecondFactor') }
  const saveAddress = async (url: string, confirm: boolean) => {
    const question = await server.saveAddress(url, confirm, t('settings.saved'))
    setAsking(question ? { question, url } : null)
    if (!question) setAddress(null)
  }
  return (
    <Card id="sign-in" icon={ShieldCheck} title={t('oidc.admin.signInTitle')}>
      {coupled ? (
        // Kept in the directory service while coupled: the switches and the address are the directory service's (the server refuses them).
        <p className="text-sm text-mist-400" data-testid="sign-in-coupled">{t('suite.managedSignIn')}</p>
      ) : (
        <>
          <Toggle
            label={t('oidc.admin.password')}
            hint={t('oidc.admin.passwordHint')}
            checked={s.password_login}
            // Without an active provider nobody but the operator could come in: the switch stays on.
            disabled={s.password_login && !anyActive}
            onChange={(password_login) => void server.save({ password_login })}
          />
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void saveAddress((address ?? s.public_url).trim(), false)
            }}
          >
            <Input
              label={t('oidc.admin.address')}
              value={address ?? s.public_url}
              onChange={setAddress}
              placeholder="https://boards.example.com"
              hint={t('oidc.admin.addressHint')}
              className="min-w-60 flex-1"
            />
            <Button type="submit" busy={server.busy}>
              {t('common.save')}
            </Button>
          </form>
          {/* Without an own second factor the operator would be the first one sent away (a1-14): first the own one. A sign-in through a
          provider whose switch says it checks the second factor itself is not sent away; both hints name that switch. */}
          <Toggle
            label={t('server.twoFactorRequired')}
            hint={!s.two_factor_required && me?.sign_in === 'password' && !me?.two_factor ? t('server.ownSecondFactorFirst', trusts) : t('server.twoFactorRequiredHint', trusts)}
            checked={s.two_factor_required}
            disabled={!s.two_factor_required && me?.sign_in === 'password' && !me?.two_factor}
            onChange={(two_factor_required) => void server.save({ two_factor_required })}
          />
        </>
      )}
      <Feedback problem={server.problem} done={server.done} />
      {asking && (
        <Confirm
          title={t('oidc.admin.address')}
          text={addressQuestionText(t, asking.question)}
          confirm={t('common.save')}
          onCancel={() => setAsking(null)}
          onConfirm={async () => saveAddress(asking.url, true)}
        />
      )}
    </Card>
  )
}

/** The sentences of the question before the public address changes (`count` entries of the button, `hand` by hand). */
function addressQuestionText(t: TFunction, question: AddressQuestion): string {
  return [
    question.count > 0 ? t('oidc.admin.addressChangeConfirm', { address: question.address }) : '',
    question.hand > 0 ? t('oidc.admin.addressChangeHand', { count: question.hand }) : '',
  ]
    .filter(Boolean)
    .join(' ')
}

// --- Card 2: the provider list ---------------------------------------------------------------------------------------

/** The same issuer, however written at the end (the server's `same_issuer` for an issuer without a placeholder). */
function sameIssuer(a: string, b: string): boolean {
  return a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '')
}

export function ProvidersCard({
  providers,
  reload,
  publicUrl,
}: {
  providers: OidcProvider[] | null
  reload: () => Promise<void>
  publicUrl: string
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<OidcProvider | 'new' | null>(null)
  const [removing, setRemoving] = useState<{ entry: OidcProvider; count: number; only: number } | null>(null)
  const [dragged, setDragged] = useState<number | null>(null)
  const { busy, problem, done, run } = useAction()
  const list = providers ?? []
  const readOnly = list.some((entry) => !entry.editable)

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= list.length) return
    const ids = list.map((entry) => entry.id)
    const [taken] = ids.splice(from, 1)
    ids.splice(to, 0, taken)
    void run(async () => {
      await oidcAdminApi.orderProviders(ids)
      await reload()
    })
  }

  return (
    <Card id="sign-in-providers" icon={KeyRound} title={t('oidc.admin.providersTitle')} text={t('oidc.admin.providersText')}>
      {providers !== null && list.length === 0 && <p className="text-sm text-mist-400">{t('oidc.admin.empty')}</p>}
      {readOnly && <p className="text-sm text-mist-400" data-testid="providers-coupled">{t('server.providers.coupledText')}</p>}
      {list.length > 0 && (
        <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700" data-testid="provider-list">
          {list.map((entry, index) => (
            <li
              key={entry.id}
              className={`flex flex-wrap items-center gap-2 px-3 py-3 text-sm ${dragged === index ? 'opacity-50' : ''}`}
              draggable={!readOnly}
              onDragStart={() => setDragged(index)}
              onDragEnd={() => setDragged(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                if (dragged !== null) move(dragged, index)
                setDragged(null)
              }}
            >
              {!readOnly && list.length > 1 && (
                <button
                  type="button"
                  className="cursor-grab rounded p-1 text-mist-500 hover:text-mist-200"
                  aria-label={t('server.providers.order', { name: entry.label })}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp') move(index, index - 1)
                    if (event.key === 'ArrowDown') move(index, index + 1)
                  }}
                >
                  <GripVertical className="h-4 w-4" aria-hidden />
                </button>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-mist-100">{entry.label}</span>
                <span className="block truncate text-xs text-mist-500">{entry.issuer}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className={`rounded-full px-2 ${entry.enabled ? 'bg-ok-500/10 text-ok-500' : 'border border-ink-700 text-mist-400'}`}>
                  {entry.enabled ? t('oidc.admin.active') : t('oidc.admin.inactive')}
                </span>
                {entry.managed === 'authentik' && (
                  <span className="rounded-full border border-accent-500/40 px-2 text-accent-400">{t('oidc.admin.managed')}</span>
                )}
                {entry.managed === 'nexsuite' && (
                  <span className="rounded-full border border-accent-500/40 px-2 text-accent-400">{t('server.providers.coupled')}</span>
                )}
              </span>
              {entry.editable && (
                <span className="flex gap-1.5">
                  <Button small onClick={() => setEditing(entry)}>
                    {t('oidc.admin.edit')}
                  </Button>
                  <Button
                    small
                    danger
                    busy={busy}
                    onClick={() =>
                      void run(async () => {
                        const impact = await oidcAdminApi.providerImpact(entry.id)
                        setRemoving({ entry, count: impact.count, only: impact.only })
                      })
                    }
                  >
                    {t('oidc.admin.remove')}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div>
          <Button accent onClick={() => setEditing('new')}>
            {t('oidc.admin.add')}
          </Button>
        </div>
      )}
      <Feedback problem={problem} done={done} />
      {editing !== null && (
        <ProviderDialog
          entry={editing === 'new' ? null : editing}
          publicUrl={publicUrl}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await reload()
          }}
        />
      )}
      {removing && (
        <Confirm
          title={t('oidc.admin.remove')}
          text={t('oidc.admin.removeConfirm', { name: removing.entry.label, count: removing.count, only: removing.only })}
          confirm={t('oidc.admin.remove')}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await oidcAdminApi.removeProvider(removing.entry.id)
            setRemoving(null)
            await reload()
          }}
        />
      )}
    </Card>
  )
}

const EMPTY: OidcProviderForm = {
  label: '',
  slug: '',
  issuer: '',
  client_id: '',
  client_secret: '',
  scopes: 'openid profile email',
  enabled: true,
  auto_create: false,
  trusts_second_factor: true,
}

type FieldName = 'label' | 'slug' | 'issuer' | 'client_id' | 'client_secret' | 'scopes' | 'id'

/** The provider form as a dialog, fields in the blueprint's order. */
function ProviderDialog({
  entry,
  publicUrl,
  onClose,
  onSaved,
}: {
  entry: OidcProvider | null
  publicUrl: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<OidcProviderForm>(
    entry
      ? {
          label: entry.label,
          issuer: entry.issuer,
          client_id: entry.client_id,
          client_secret: '',
          scopes: entry.scopes,
          enabled: entry.enabled,
          auto_create: entry.auto_create,
          trusts_second_factor: entry.trusts_second_factor,
        }
      : EMPTY,
  )
  // The short name follows the name on the button until it is typed itself.
  const [slugTyped, setSlugTyped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState<{ field: FieldName; text: string } | null>(null)
  const [confirmIssuer, setConfirmIssuer] = useState<number | null>(null)

  const slug = entry ? entry.slug : slugTyped ? (form.slug ?? '') : slugFromLabel(form.label)
  const base = (publicUrl || window.location.origin).replace(/\/+$/, '')
  const redirect = entry ? entry.redirect_uri : `${base}/api/oidc/${slug || '…'}/callback`

  const set = (change: Partial<OidcProviderForm>) => setForm((current) => ({ ...current, ...change }))

  const errorFor = (error: unknown): { field: FieldName; text: string } => {
    if (!(error instanceof ApiError)) return { field: 'id', text: errorText('internal_error') }
    const field = (typeof error.values.field === 'string' ? error.values.field : 'id') as FieldName
    const key = oidcFormErrorKey(error.code) ?? oidcErrorKey(error.code)
    return { field, text: key ? t(key) : errorText(error.code, error.values) }
  }

  const save = async () => {
    setBusy(true)
    setFieldError(null)
    try {
      const body = { ...form, slug: entry ? undefined : slug }
      if (entry) await oidcAdminApi.saveProvider(entry.id, body)
      else await oidcAdminApi.addProvider(body)
      await onSaved()
    } catch (error) {
      setFieldError(errorFor(error))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    // Another issuer is another provider: say first how many accounts will have to link again.
    if (entry && entry.links > 0 && !sameIssuer(entry.issuer, form.issuer)) {
      try {
        const impact = await oidcAdminApi.providerImpact(entry.id, form.issuer.trim())
        if (impact.issuer_change > 0) return setConfirmIssuer(impact.issuer_change)
      } catch (error) {
        return setFieldError(errorFor(error))
      }
    }
    await save()
  }

  const problemAt = (field: FieldName) => (fieldError?.field === field ? <FieldProblem text={fieldError.text} /> : null)

  return (
    <Dialog title={entry ? `${t('oidc.admin.edit')}: ${entry.label}` : t('oidc.admin.add')} onClose={() => !busy && onClose()} medium>
      <form className="space-y-3" onSubmit={(event) => void submit(event)} data-testid="provider-form">
        <Input label={t('oidc.admin.label')} value={form.label} onChange={(label) => set({ label })} />
        {problemAt('label')}
        {entry ? (
          <p className="text-xs text-mist-500">
            {t('oidc.admin.slug')}: <code className="font-mono text-mist-300">{entry.slug}</code>
          </p>
        ) : (
          <>
            <Input
              label={t('oidc.admin.slug')}
              value={slug}
              onChange={(value) => {
                setSlugTyped(true)
                set({ slug: value })
              }}
              hint={t('oidc.admin.slugHint')}
            />
            {problemAt('slug')}
          </>
        )}
        <Input
          label={t('oidc.admin.issuer')}
          value={form.issuer}
          onChange={(issuer) => set({ issuer })}
          placeholder="https://auth.example.com/application/o/nexcanvas/"
          hint={t('oidc.admin.issuerHint')}
        />
        {problemAt('issuer')}
        <Input label={t('oidc.admin.clientId')} value={form.client_id} onChange={(client_id) => set({ client_id })} />
        {problemAt('client_id')}
        <Input
          label={t('oidc.admin.secret')}
          value={form.client_secret}
          onChange={(client_secret) => set({ client_secret })}
          type="password"
          autoComplete="new-password"
          placeholder={entry?.has_secret ? t('oidc.admin.secretKept') : ''}
        />
        {problemAt('client_secret')}
        <div className="text-sm">
          <span className="text-xs font-medium text-mist-400">{t('oidc.admin.redirect')}</span>
          <div className="mt-1">
            <CopyLink value={redirect} label={t('oidc.admin.redirect')} />
          </div>
        </div>
        <Toggle label={t('oidc.admin.enabled')} checked={form.enabled} onChange={(enabled) => set({ enabled })} />
        <Toggle label={t('oidc.admin.autoCreate')} hint={t('oidc.admin.autoCreateHint')} checked={form.auto_create} onChange={(auto_create) => set({ auto_create })} />
        <Toggle
          label={t('oidc.admin.trustsSecondFactor')}
          hint={t('oidc.admin.trustsSecondFactorHint')}
          checked={form.trusts_second_factor}
          onChange={(trusts_second_factor) => set({ trusts_second_factor })}
        />
        <details open={fieldError?.field === 'scopes' || undefined}>
          <summary className="cursor-pointer text-xs text-mist-400">{t('server.providers.more')}</summary>
          <div className="mt-2">
            <Input label={t('oidc.admin.scopes')} value={form.scopes} onChange={(scopes) => set({ scopes })} />
            {problemAt('scopes')}
          </div>
        </details>
        {problemAt('id')}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose} busy={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" accent busy={busy}>
            {t('common.save')}
          </Button>
        </div>
      </form>
      {confirmIssuer !== null && (
        <Confirm
          title={t('oidc.admin.issuer')}
          text={t('oidc.admin.issuerChangeConfirm', { count: confirmIssuer })}
          confirm={t('common.save')}
          danger
          onCancel={() => setConfirmIssuer(null)}
          onConfirm={async () => {
            setConfirmIssuer(null)
            await save()
          }}
        />
      )}
    </Dialog>
  )
}

function FieldProblem({ text }: { text: string }) {
  return (
    <p role="alert" className="-mt-1 text-xs text-bad-500">
      {text}
    </p>
  )
}

// --- Card 3: authentik in one step ------------------------------------------------------------------------------------

export function AuthentikCard({
  publicUrl,
  coupled,
  reload,
  onAddress,
}: {
  /** The address in the settings: when it changes (card 1 saved it), the card reads what it shows again. */
  publicUrl: string
  coupled: boolean
  reload: () => Promise<void>
  /** The card stored the public address: the settings above are read again. */
  onAddress: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [authentik, setAuthentik] = useState({ url: '', token: '' })
  const [steps, setSteps] = useState<AuthentikResult | null>(null)
  // The button stopped before an issuer change and asks how many accounts would have to link again.
  const [asking, setAsking] = useState<number | null>(null)
  // "Use it only" asks too when the address changes what authentik knows.
  const [askingAddress, setAskingAddress] = useState<AddressQuestion | null>(null)
  const [unusable, setUnusable] = useState(false)
  const [address, setAddress] = useState<AuthentikAddress | null>(null)
  const { busy, problem, run } = useAction()

  const loadAddress = useCallback(() => oidcAdminApi.authentikAddress().then(setAddress, () => setAddress(null)), [])
  useEffect(() => {
    if (!coupled) void loadAddress()
  }, [coupled, publicUrl, loadAddress])

  // Without a public address of its own nexcanvas suggests the one this browser uses; the operator confirms it with the
  // button (never a guess from the request: the server sees http behind a proxy that ends TLS).
  const proposal = authentikProposal(window.location.origin, import.meta.env.BASE_URL)
  const noAddress = !coupled && address !== null && !address.public_url
  const stale = coupled ? null : authentikStale(address)

  const start = (confirmIssuerChange: boolean) => {
    // What the last attempt said goes first: an old failure stood above the new answer.
    setSteps(null)
    setAsking(null)
    setUnusable(false)
    void run(async () => {
      const answer = await oidcAdminApi.authentik(authentik.url, authentik.token, confirmIssuerChange, noAddress ? proposal : '')
      setSteps(answer)
      setAsking(authentikIssuerChange(answer))
      if (answer.address) setAddress(answer.address)
      // The token goes only once everything worked; after a failure the operator corrects the address and
      // tries again.
      if (answer.ok) setAuthentik((current) => ({ ...current, token: '' }))
      await reload()
      // A run that failed after the address was stored leaves it stored: the card shows the ordinary button then.
      if (answer.public_url) await onAddress()
      await loadAddress()
    })
  }

  const adoptOnly = (confirm: boolean) => {
    setSteps(null)
    setUnusable(false)
    void run(async () => {
      try {
        setAddress(await oidcAdminApi.authentikSaveAddress(proposal, confirm))
        setAskingAddress(null)
        await onAddress()
      } catch (error) {
        if (error instanceof ApiError && error.code === 'public_url_change') {
          setAskingAddress({ count: Number(error.values.count ?? 0), hand: Number(error.values.hand ?? 0), address: String(error.values.address ?? '') })
          return ASKED
        }
        if (error instanceof ApiError && error.code === 'public_url_invalid') {
          setUnusable(true)
          return ASKED
        }
        throw error
      }
    })
  }

  return (
    <Card id="sign-in-authentik" icon={Sparkles} title={t('oidc.authentik.title')} text={t('oidc.authentik.text')}>
      {coupled && <p className="text-sm text-warn-500" data-testid="authentik-coupled">{t('oidc.authentik.why.coupled')}</p>}
      {noAddress && address && (
        <div className="space-y-1.5 rounded-lg border border-warn-500/30 bg-warn-500/10 px-3 py-2 text-xs text-warn-500" data-testid="authentik-no-address">
          <p>{t('oidc.authentik.noAddress')}</p>
          <code className="block font-mono text-sm break-all text-mist-100" data-testid="authentik-proposal">
            {proposal}
          </code>
          <p className="text-mist-400">
            {t('oidc.admin.redirect')}: <code className="font-mono break-all text-mist-200">{authentikRedirect(proposal, address)}</code>
          </p>
          {authentikProxyWarning(proposal, address) && <p data-testid="authentik-proxy-warning">{t('oidc.authentik.proxyWarning', { address: address.seen })}</p>}
        </div>
      )}
      {stale && (
        <p className="rounded-lg border border-warn-500/30 bg-warn-500/10 px-3 py-2 text-xs text-warn-500" data-testid="authentik-stale">
          {t('oidc.authentik.stale', { address: stale })}
        </p>
      )}
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (coupled) return
          start(false)
        }}
      >
        <Input label={t('oidc.authentik.url')} value={authentik.url} onChange={(url) => setAuthentik({ ...authentik, url })} placeholder="https://auth.example.com" />
        <Input label={t('oidc.authentik.token')} value={authentik.token} onChange={(token) => setAuthentik({ ...authentik, token })} type="password" autoComplete="new-password" />
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="submit" accent busy={busy} disabled={coupled || !authentik.url.trim() || !authentik.token.trim()}>
            {noAddress ? t('oidc.authentik.adopt') : t('oidc.authentik.run')}
          </Button>
          {noAddress && (
            <Button busy={busy} onClick={() => adoptOnly(false)}>
              {t('oidc.authentik.adoptOnly')}
            </Button>
          )}
          {coupled || noAddress ? (
            <span className="text-sm text-mist-500">{t('oidc.authentik.blueprint')}</span>
          ) : (
            <a href="/api/oidc/authentik/blueprint" className="text-sm text-accent-400 hover:underline">
              {t('oidc.authentik.blueprint')}
            </a>
          )}
        </div>
      </form>
      {unusable && (
        <p role="alert" className="text-xs text-bad-500" data-testid="authentik-unusable">
          {t('oidc.authentik.why.unusable')}
        </p>
      )}
      {busy && (
        <p role="status" className="text-xs text-mist-400">
          {t('oidc.authentik.asking')}
        </p>
      )}
      {steps && (
        <ol className="space-y-1.5 text-sm" data-testid="authentik-steps">
          {steps.steps.map((step) => {
            const name = authentikStepKey(step.key)
            const why = step.ok ? null : authentikReasonKey(step.reason)
            return (
              <li key={step.key} className="flex gap-2">
                <span className={step.ok ? 'text-ok-500' : 'text-bad-500'} aria-hidden="true">
                  {step.ok ? '✓' : '✗'}
                </span>
                <span>
                  <span className={step.ok ? 'text-mist-200' : 'font-medium text-bad-500'}>{name ? t(name) : step.key}</span>
                  {why && <span className="block text-xs text-mist-400">{t(why, { status: step.status ?? 0, count: steps.count ?? 0 })}</span>}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      <Feedback problem={problem} />
      {asking !== null && (
        <Confirm
          title={t('oidc.admin.issuer')}
          text={t('oidc.admin.issuerChangeConfirm', { count: asking })}
          confirm={t('oidc.authentik.run')}
          danger
          onCancel={() => setAsking(null)}
          onConfirm={async () => start(true)}
        />
      )}
      {askingAddress && (
        <Confirm
          title={t('oidc.admin.address')}
          text={addressQuestionText(t, askingAddress)}
          confirm={t('oidc.authentik.adoptOnly')}
          onCancel={() => setAskingAddress(null)}
          onConfirm={async () => adoptOnly(true)}
        />
      )}
    </Card>
  )
}
