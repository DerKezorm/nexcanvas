/**
 * The own account, built as nexlore's (same parts, same words, same order): Profile (picture, display name, name, role,
 * mail address), Security (password, second factor, the link to the provider, signing out everywhere), Connections
 * (API tokens for programs) and Shapes (which packages the own library shows). The tab stands in the address (`?tab=`).
 */
import { KeyRound, Lock, Plug, Shapes, Shield, ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { api, ApiError, authApi, type Me, type Methods } from '../api/client'
import { ApiTokens } from '../components/ApiTokens'
import { Avatar } from '../components/Avatar'
import { Field, Problem } from '../components/Field'
import { LibraryChoice } from '../components/LibraryChoice'
import { Section } from '../components/Section'
import { Managed } from '../components/Suite'
import { errorText } from '../lib/errors'
import { useAuth } from '../state/auth'
import { saveAsFile, TabRow, type Tab } from './settings/ui'
import { copyText } from '../lib/copy'

type Part = 'profile' | 'security' | 'connections' | 'shapes'
const PARTS: Part[] = ['profile', 'security', 'connections', 'shapes']

const QUIET = 'rounded-full border border-ink-700 px-3 py-1 text-xs text-mist-300 hover:bg-ink-850 disabled:opacity-50'
const LOUD = 'rounded-full bg-accent-500 px-4 py-1.5 text-sm font-semibold text-on-accent hover:bg-accent-400 disabled:opacity-50'
const PLAIN = 'rounded-full border border-ink-700 px-4 py-1.5 text-sm text-mist-300 hover:bg-ink-850 disabled:opacity-50'

function code(error: unknown): string {
  return error instanceof ApiError ? error.code : 'internal_error'
}

export function AccountPage() {
  const { t } = useTranslation()
  const { me, setMe, refresh } = useAuth()
  const [shownAs, setShownAs] = useState(me?.display_name ?? '')
  // Whether a sign-in provider is set up at all: without one there is nothing to link.
  const [methods, setMethods] = useState<Methods | null>(null)
  useEffect(() => {
    authApi.methods().then(setMethods, () => setMethods(null))
  }, [])
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab') as Part | null
  // Back from the provider (linking the account): its answer stands on the security tab.
  const part: Part = asked && PARTS.includes(asked) ? asked : params.get('linked') || params.get('error') ? 'security' : 'profile'
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [linkPassword, setLinkPassword] = useState('')
  const [done, setDone] = useState<string | null>(params.get('linked') ? t('me.linked') : null)
  const [problem, setProblem] = useState<string | null>(params.get('error') ? errorText(params.get('error')!) : null)
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  if (!me) return null

  const tabs: Tab<Part>[] = [
    { value: 'profile', label: t('me.tabs.profile'), icon: UserRound },
    { value: 'security', label: t('me.tabs.security'), icon: Shield },
    { value: 'connections', label: t('me.tabs.connections'), icon: Plug },
    { value: 'shapes', label: t('me.tabs.shapes'), icon: Shapes },
  ]

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setProblem(null)
    setDone(null)
    try {
      await action()
      setDone(success)
      await refresh()
    } catch (error) {
      setProblem(errorText(code(error)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="nc-scroll min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-mist-100">{t('me.title')}</h1>
        </div>
        <TabRow
          tabs={tabs}
          active={part}
          onChange={(value) => {
            setDone(null)
            setProblem(null)
            setParams(value === 'profile' ? {} : { tab: value }, { replace: true })
          }}
          label={t('me.title')}
        />
        <div aria-live="polite">
          <Problem text={problem} />
          {done && <p className="rounded-lg border border-ok-500/30 bg-ok-500/10 px-3 py-2 text-sm text-ok-500">{done}</p>}
        </div>

        {part === 'profile' && (
          <Section icon={UserRound} title={t('me.tabs.profile')}>
            <div className="mb-5 flex flex-wrap items-center gap-4">
              <Avatar person={me} className="h-20 w-20 text-3xl" />
              <div className="space-y-2" hidden={me?.suite === 'connected'}>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => picker.current?.click()} className={LOUD}>
                    {me.avatar ? t('me.profile.change') : t('me.profile.upload')}
                  </button>
                  {me.avatar && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(async () => setMe(await api<Me>('/api/auth/avatar', { method: 'DELETE' })), t('me.profile.removed'))}
                      className={PLAIN}
                    >
                      {t('me.profile.remove')}
                    </button>
                  )}
                </div>
                <p className="text-xs text-mist-500">{t('me.profile.hint')}</p>
              </div>
              <input
                ref={picker}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif,image/avif,.heic,.heif"
                aria-label={t('me.profile.upload')}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void run(async () => setMe(await api<Me>('/api/auth/avatar', { method: 'PUT', raw: file })), t('me.profile.saved'))
                }}
              />
            </div>
            {/* How others see this account; the name below stays what one signs in with. */}
            {me?.suite === 'connected' && <Managed text={t('suite.managedProfile')} />}
            <form
              hidden={me?.suite === 'connected'}
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                void run(async () => {
                  const saved = await authApi.profile(shownAs.trim())
                  setShownAs(saved.display_name)
                  setMe(saved)
                }, t('me.profile.displaySaved'))
              }}
            >
              <div className="min-w-0 flex-1">
                <Field label={t('me.profile.displayName')} value={shownAs} onChange={setShownAs} autoComplete="name" />
              </div>
              <button type="submit" disabled={busy || shownAs.trim() === (me.display_name ?? '')} className="h-10 rounded-full bg-accent-500 px-4 text-sm font-semibold text-on-accent hover:bg-accent-400 disabled:opacity-40">
                {t('me.profile.displaySave')}
              </button>
            </form>
            {/* Under the row, so the button sits beside the field and not beside its explanation. */}
            <p className="mt-1 text-xs text-mist-500">{t('me.profile.displayHint', { name: me.name })}</p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm" data-testid="account-facts">
              <dt className="text-mist-500">{t('me.profile.name')}</dt>
              <dd className="text-mist-100">{me.name}</dd>
              <dt className="text-mist-500">{t('me.profile.role')}</dt>
              <dd className="text-mist-100">{t(`me.role.${me.role}`)}</dd>
              {me.email && (
                <>
                  <dt className="text-mist-500">{t('me.profile.email')}</dt>
                  <dd className="text-mist-100">{me.email}</dd>
                </>
              )}
            </dl>
          </Section>
        )}

        {part === 'security' && (
          <>
            {me.second_factor_setup_required && (
              <p role="note" className="rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3 text-sm text-warn-500">
                {t('me.setupFirst')}
              </p>
            )}
            {me.suite_emergency && <Managed text={t('suite.emergencyAccount')} />}
            {me.sign_in === 'password' && (
              <Section icon={KeyRound} title={t('me.password.title')}>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!current) return setProblem(errorText('current_password_missing'))
                    if (!next) return setProblem(errorText('password_missing'))
                    if (next !== again) return setProblem(t('me.password.mismatch'))
                    void run(async () => {
                      await authApi.password(current, next)
                      setCurrent('')
                      setNext('')
                      setAgain('')
                    }, t('me.password.done'))
                  }}
                >
                  <Field label={t('me.password.current')} value={current} onChange={setCurrent} type="password" autoComplete="current-password" />
                  <Field label={t('me.password.new')} value={next} onChange={setNext} type="password" autoComplete="new-password" hint={t('auth.passwordHint')} />
                  <Field label={t('me.password.again')} value={again} onChange={setAgain} type="password" autoComplete="new-password" />
                  <button type="submit" disabled={busy} className={LOUD}>
                    {t('me.password.submit')}
                  </button>
                </form>
              </Section>
            )}

            <Section icon={ShieldCheck} title={t('twofactor.title')}>
              {/* Connected: who signs in through nexsuite sets the second factor there; only the emergency account keeps its own here. */}
              {me.suite === 'connected' && me.sign_in !== 'password' ? <Managed text={t('suite.managedTwoFactor')} /> : <SecondFactor me={me} />}
            </Section>

            {me.suite !== 'connected' && (methods?.oidc || me.sign_in === 'oidc' || me.oidc_linked) && (
              <Section icon={Shield} title={t('me.oidc.title')}>
                {me.sign_in === 'oidc' ? (
                  <p className="text-sm text-mist-400">{t('me.oidc.only')}</p>
                ) : me.oidc_linked ? (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="text-mist-400">{t('me.oidc.linked')}</span>
                    <button type="button" disabled={busy} onClick={() => void run(() => api('/api/oidc/link', { method: 'DELETE' }), t('me.oidc.unlinked'))} className={QUIET}>
                      {t('me.oidc.unlink')}
                    </button>
                  </div>
                ) : (
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault()
                      setBusy(true)
                      setProblem(null)
                      api<{ url: string }>('/api/oidc/link/start', { method: 'POST', body: { password: linkPassword } }).then(
                        ({ url }) => window.location.assign(url),
                        (error) => {
                          setProblem(errorText(code(error)))
                          setBusy(false)
                        },
                      )
                    }}
                  >
                    <p className="text-sm text-mist-400">{t('me.oidc.text')}</p>
                    <Field label={t('auth.password')} value={linkPassword} onChange={setLinkPassword} type="password" autoComplete="current-password" />
                    <button type="submit" disabled={busy} className={PLAIN}>
                      {t('me.oidc.link')}
                    </button>
                  </form>
                )}
              </Section>
            )}

            <Section icon={Lock} title={t('me.sessions.title')}>
              <p className="mb-3 text-sm text-mist-400">{t('me.sessions.text')}</p>
              <button type="button" disabled={busy} onClick={() => void run(() => api('/api/auth/logout-all', { method: 'POST' }), t('me.sessions.done'))} className={PLAIN}>
                {t('me.sessions.submit')}
              </button>
            </Section>
          </>
        )}

        {part === 'connections' && <ApiTokens />}
        {part === 'shapes' && <LibraryChoice me={me} />}
      </div>
    </main>
  )
}

/** Below this many recovery codes the account is told to make new ones. */
const LOW_CODES = 3

type Enrolment = { secret: string; uri: string; qr_svg: string }

/**
 * The second factor of the own account: set up (scan the code, type one code and the password), new recovery codes,
 * turn off. Recovery codes are shown once, right after they were made, to copy or save as a file.
 */
function SecondFactor({ me }: { me: Me }) {
  const { t } = useTranslation()
  const { refresh } = useAuth()
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [asking, setAsking] = useState<'disable' | 'renew' | null>(null)
  const [digits, setDigits] = useState('')
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  if (me.sign_in !== 'password') return <p className="text-sm text-mist-400">{t('twofactor.provider')}</p>

  const close = () => {
    setEnrolment(null)
    setAsking(null)
    setDigits('')
    setPassword('')
    setProblem(null)
  }

  const act = async (work: () => Promise<void>) => {
    setBusy(true)
    setProblem(null)
    try {
      await work()
    } catch (error) {
      setProblem(errorText(code(error)))
    } finally {
      setBusy(false)
    }
  }

  const codesText = (codes ?? []).join('\n')

  return (
    <div className="space-y-3 text-sm" data-testid="second-factor">
      <p className="text-mist-400">{t('twofactor.lead')}</p>
      {!enrolment && <Problem text={problem} />}

      {codes ? (
        <div className="space-y-3 rounded-xl border border-accent-500/40 bg-accent-500/10 p-3" data-testid="recovery-codes">
          <p className="font-semibold text-mist-100">{t('twofactor.codesTitle')}</p>
          <p className="text-xs text-mist-400">{t('twofactor.codesLead')}</p>
          <ol className="grid grid-cols-2 gap-2 rounded-lg bg-ink-950 px-4 py-3 font-mono text-sm text-mist-100">
            {codes.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={QUIET} onClick={() => void copyText(codesText).then(setCopied)}>
              {copied ? t('common.copied') : t('twofactor.codesCopy')}
            </button>
            <button type="button" className={QUIET} onClick={() => saveAsFile(`nexcanvas-recovery-codes-${me.name}.txt`, new Blob([codesText + '\n'], { type: 'text/plain' }))}>
              {t('twofactor.codesDownload')}
            </button>
            <button
              type="button"
              className={LOUD}
              onClick={() => {
                setCodes(null)
                setCopied(false)
                void refresh()
              }}
            >
              {t('twofactor.codesDone')}
            </button>
          </div>
        </div>
      ) : enrolment ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void act(async () => {
              const result = await api<{ recovery_codes: string[] }>('/api/auth/totp/confirm', { method: 'POST', body: { code: digits.trim(), password } })
              close()
              setCodes(result.recovery_codes)
            })
          }}
        >
          <p className="text-mist-300">{t('twofactor.scan')}</p>
          <div className="flex justify-center">
            <img src={'data:image/svg+xml;utf8,' + encodeURIComponent(enrolment.qr_svg)} alt={t('twofactor.qr')} width={196} height={196} className="rounded-lg" />
          </div>
          <p className="text-xs text-mist-500">{t('twofactor.secret')}</p>
          <code className="block rounded-lg bg-ink-950 px-3 py-2 font-mono text-xs break-all text-mist-200" data-testid="totp-secret">
            {enrolment.secret.replace(/(.{4})/g, '$1 ').trim()}
          </code>
          <Field label={t('twofactor.code')} value={digits} onChange={setDigits} autoComplete="one-time-code" autoFocus />
          <Field label={t('auth.password')} value={password} onChange={setPassword} type="password" autoComplete="current-password" hint={t('twofactor.passwordHint')} />
          <Problem text={problem} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="rounded-full px-3 py-1 text-sm text-mist-400">
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={busy || digits.trim().length !== 6 || !password} className={LOUD}>
              {t('twofactor.confirm')}
            </button>
          </div>
        </form>
      ) : asking ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void act(async () => {
              if (asking === 'disable') {
                await api('/api/auth/totp/disable', { method: 'POST', body: { password } })
                close()
                await refresh()
              } else {
                const result = await api<{ recovery_codes: string[] }>('/api/auth/totp/recovery', { method: 'POST', body: { password } })
                close()
                setCodes(result.recovery_codes)
              }
            })
          }}
        >
          <p className="text-mist-300">{asking === 'disable' ? t('twofactor.disableText') : t('twofactor.renewText')}</p>
          <Field label={t('auth.password')} value={password} onChange={setPassword} type="password" autoComplete="current-password" autoFocus />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="rounded-full px-3 py-1 text-sm text-mist-400">
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={busy || !password} className={asking === 'disable' ? 'rounded-full bg-bad-500 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50' : LOUD}>
              {asking === 'disable' ? t('twofactor.disable') : t('twofactor.renew')}
            </button>
          </div>
        </form>
      ) : me.two_factor ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-mist-200">
            <ShieldCheck className="h-4 w-4 text-ok-500" />
            {t('twofactor.on', { count: me.two_factor_recovery_left })}
          </span>
          <button type="button" className={QUIET} onClick={() => setAsking('renew')}>
            {t('twofactor.renew')}
          </button>
          <button type="button" className={QUIET} onClick={() => setAsking('disable')}>
            {t('twofactor.disable')}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-mist-400">{t('twofactor.off')}</span>
          <button type="button" disabled={busy} className={LOUD} onClick={() => void act(async () => setEnrolment(await api<Enrolment>('/api/auth/totp/begin', { method: 'POST' })))}>
            {t('twofactor.enable')}
          </button>
        </div>
      )}
      {!codes && me.two_factor && me.two_factor_recovery_left < LOW_CODES && (
        <p role="note" className="rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs text-warn-500">
          {t('twofactor.lowCodes')}
        </p>
      )}
    </div>
  )
}
