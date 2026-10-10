/**
 * The pages before signing in, as in nexlore: the first account (with the setup code from the server's log),
 * signing in (password, then the second factor; or the provider's button), and accepting an invitation.
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { ApiError, api, authApi, type Me, type Methods } from '../api/client'
import { Logo } from '../components/Logo'
import { ProviderButtons } from '../components/ProviderButtons'
import { ThemeSwitcher } from '../components/ThemeSwitcher'
import i18n from '../i18n'
import { errorText, signInErrorText } from '../lib/errors'
import { startAddress } from '../lib/providers'
import { safeNext, useAuth } from '../state/auth'
import { useTitle } from '../lib/title'

function AuthFrame({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  useTitle(title)
  return (
    <div className="nc-scroll flex min-h-dvh flex-col overflow-y-auto">
      <header className="flex items-center justify-between px-5 py-4">
        <Logo withWordmark />
        <ThemeSwitcher />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-10">
        <div className="w-full max-w-sm rounded-2xl border border-ink-700 bg-ink-900 p-6 shadow-xl">
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          {text && <p className="mt-1 text-sm text-mist-500">{text}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </main>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', autoComplete, autoFocus = false, hint, maxLength }: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  autoComplete?: string
  autoFocus?: boolean
  hint?: string
  maxLength?: number
}) {
  const hintId = useId()
  return (
    <div className="text-sm">
      <label className="block">
        <span className="font-medium">{label}</span>
        <input
          type={type}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          maxLength={maxLength}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 h-10 w-full rounded-lg border border-edge bg-ink-850 px-3 text-sm outline-none focus:border-accent-500"
        />
      </label>
      {hint && (
        <span id={hintId} className="mt-1 block text-xs text-mist-500">
          {hint}
        </span>
      )}
    </div>
  )
}

function Primary({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return (
    <button type="submit" disabled={busy} className="h-10 w-full rounded-full bg-accent-500 px-4 text-sm font-semibold text-on-accent hover:bg-accent-400 disabled:opacity-50">
      {children}
    </button>
  )
}

function Problem({ code, fromAddress = false }: { code: string | null; fromAddress?: boolean }) {
  if (!code) return null
  return (
    <p role="alert" className="rounded-lg border border-bad-500/30 bg-bad-500/10 px-3 py-2 text-sm text-bad-500">
      {fromAddress ? signInErrorText(code) : errorText(code)}
    </p>
  )
}

const codeOf = (error: unknown) => (error instanceof ApiError ? error.code : 'internal_error')

/** How long the pages wait for the ways in before they fall back to the password, as on a failed answer. */
export const WAYS_IN_WAIT_MS = 5000
const PASSWORD_ONLY: Methods = { password: true, providers: [] }

/** The ways in, or the password way when the answer fails or does not come in time: the page waits for them before it
 * shows a form, and must not stay empty for good behind an answer that hangs. */
function waysIn(): Promise<Methods> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(PASSWORD_ONLY), WAYS_IN_WAIT_MS)
    authApi.methods().then(
      // An answer without a list (an older server during an update) has no buttons, not a broken page.
      (methods) => resolve({ ...methods, providers: Array.isArray(methods.providers) ? methods.providers : [] }),
      () => resolve(PASSWORD_ONLY),
    ).finally(() => window.clearTimeout(timer))
  })
}

export function SetupPage() {
  const { t } = useTranslation()
  const { status, setMe } = useAuth()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  if (status === 'loading') return null
  if (status !== 'setup') return <Navigate to="/" replace />
  return (
    <AuthFrame title={t('auth.setup.title')} text={t('auth.setup.text')}>
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!name.trim()) return setProblem('name_missing')
          setBusy(true)
          setProblem(null)
          try {
            setMe(await authApi.setup(name.trim(), password, code.trim(), i18n.language))
          } catch (error) {
            setProblem(codeOf(error))
          } finally {
            setBusy(false)
          }
        }}
      >
        <Problem code={problem} />
        <Field label={t('auth.setup.code')} value={code} onChange={setCode} autoFocus hint={t('auth.setup.codeHint')} />
        <Field label={t('auth.name')} value={name} onChange={setName} autoComplete="username" />
        <Field label={t('auth.password')} value={password} onChange={setPassword} type="password" autoComplete="new-password" hint={t('auth.passwordHint')} />
        <Primary busy={busy}>{t('auth.setup.submit')}</Primary>
      </form>
    </AuthFrame>
  )
}

export function LoginPage({ emergency = false }: { emergency?: boolean }) {
  const { t } = useTranslation()
  const { status, setMe } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [methods, setMethods] = useState<Methods | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  // After a provider that is not trusted with the second factor the server parked the sign-in: the code step.
  const [step, setStep] = useState<'password' | 'code'>(params.get('step') === 'code' ? 'code' : 'password')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(params.get('error'))
  // The problem came from the provider's way back (`?error=`), not from this page's own form.
  const [fromAddress, setFromAddress] = useState(params.get('error') !== null)
  // Password sign-in off: the form waits behind "Sign in as the operator with a password".
  const [operatorWay, setOperatorWay] = useState(false)
  const next = safeNext(params.get('next'))
  /** Sent here from an open board whose session ended (blocked, signed out everywhere, E2). */
  const ended = params.get('ended') === '1'

  useEffect(() => {
    void waysIn().then(setMethods)
  }, [])

  if (status === 'loading') return null
  if (status === 'setup') return <Navigate to="/setup" replace />
  if (status === 'signedIn') return <Navigate to={next} replace />
  // Nothing until the ways in are known: connected, the password form flashed up before the nexsuite button, and the
  // emergency page first read as the usual one (as nextasks and nexbrand).
  if (methods === null) return null

  const submit = async () => {
    if (step === 'password' && !name.trim()) return setProblem('name_missing')
    if (step === 'password' && !password) return setProblem('password_missing')
    setBusy(true)
    setProblem(null)
    setFromAddress(false)
    try {
      let answer: Me | { second_factor: true }
      if (step === 'code') answer = await authApi.code(code.trim())
      else answer = await authApi.login(name.trim(), password)
      if ('second_factor' in answer) {
        setPassword('')
        setStep('code')
        return
      }
      setMe(await authApi.me())
      navigate(next, { replace: true })
    } catch (error) {
      const found = codeOf(error)
      setProblem(found)
      if (found === 'second_factor_expired') {
        setStep('password')
        setCode('')
      }
    } finally {
      setBusy(false)
    }
  }

  if (step === 'code') {
    return (
      <AuthFrame title={t('auth.code.title')} text={t('auth.code.text')}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (code.trim()) void submit()
          }}
        >
          <Problem code={problem} fromAddress={fromAddress} />
          <Field label={t('auth.code.label')} value={code} onChange={setCode} autoComplete="one-time-code" autoFocus hint={t('auth.code.hint')} />
          <Primary busy={busy}>{t('auth.login.submit')}</Primary>
          <button
            type="button"
            className="w-full text-center text-xs text-mist-500 hover:text-mist-300"
            onClick={() => {
              void authApi.cancelCode().catch(() => undefined)
              setStep('password')
              setCode('')
              setProblem(null)
            }}
          >
            {t('auth.code.back')}
          </button>
        </form>
      </AuthFrame>
    )
  }

  if (methods?.suite && !emergency) {
    return (
      <AuthFrame title={t('auth.login.title')} text={t('suite.loginText')}>
        {/* Connected, a new password in nexsuite ends the sessions here too (B12). */}
        {ended && <p className="mb-3 rounded-xl border border-warn-500/30 bg-warn-500/10 px-3 py-2 text-xs text-mist-200">{t('auth.login.endedSuite')}</p>}
        <Problem code={problem} fromAddress={fromAddress} />
        {/* The coupled entry of the provider list (slug "oidc"); its button names nexsuite (blueprint 06: the app
            names it). */}
        <a href={startAddress(methods.providers[0]?.slug ?? 'oidc', { next })} className="nc-btn nc-btn-accent flex h-10 w-full items-center justify-center">
          {t('suite.loginButton')}
        </a>
        {/* Signing out here leaves nexsuite signed in, and the button would bring the same person back (B11). Who is
            signed in there this page cannot tell without asking nexsuite, so it says it in general. */}
        <div className="mt-4 space-y-1.5 text-xs text-mist-500" data-testid="still-signed-in">
          <p>{t('suite.stillSignedIn')}</p>
          {methods.suite_url && (
            <p>
              <a href={methods.suite_url} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-400 hover:underline">
                {t('suite.someoneElse')}
              </a>
              {' · '}
              {t('suite.someoneElseHint')}
            </p>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-mist-600">
          <Link to="/notzugang" className="hover:text-mist-300">
            {t('suite.emergencyLink')}
          </Link>
        </p>
      </AuthFrame>
    )
  }

  // The emergency page speaks of nexsuite only while connected; alone it is the usual sign-in (H, b3).
  const emergencyNow = emergency && !!methods?.suite
  // Blueprint 04: password form, below the line "or" a button per active provider. With the password sign-in off only
  // the buttons, and small at the bottom the operator's way in with the password.
  const providers = emergency ? [] : methods.providers
  const passwordShown = methods.password || providers.length === 0 || operatorWay || emergency
  const endedNote = ended && <p className="rounded-xl border border-warn-500/30 bg-warn-500/10 px-3 py-2 text-xs text-mist-200">{t(methods?.suite ? 'auth.login.endedSuite' : 'auth.login.ended')}</p>
  return (
    <AuthFrame title={emergencyNow ? t('suite.emergencyTitle') : t('auth.login.title')} text={emergencyNow ? t('suite.emergencyLoginText') : t('auth.login.text')}>
      {passwordShown ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {endedNote}
          <Problem code={problem} fromAddress={fromAddress} />
          <Field label={t('auth.name')} value={name} onChange={setName} autoComplete="username" autoFocus />
          <Field label={t('auth.password')} value={password} onChange={setPassword} type="password" autoComplete="current-password" />
          <Primary busy={busy}>{t('auth.login.submit')}</Primary>
        </form>
      ) : (
        <div className="space-y-4">
          {endedNote}
          <Problem code={problem} fromAddress={fromAddress} />
        </div>
      )}
      <ProviderButtons providers={providers} next={next} withOr={passwordShown} />
      {!passwordShown && (
        <button type="button" className="mt-4 w-full text-center text-xs text-mist-500 hover:text-mist-300" onClick={() => setOperatorWay(true)}>
          {t('oidc.login.operator')}
        </button>
      )}
      {emergencyNow && (
        <p className="mt-4 text-center text-xs text-mist-600">
          <Link to="/login" className="hover:text-mist-300">
            {t('auth.backToLogin')}
          </Link>
        </p>
      )}
    </AuthFrame>
  )
}

type InviteState = { space: string | null; role: string | null; min_password: number; signed_in_as: string | null; by?: string | null }

export function InvitePage() {
  const { t } = useTranslation()
  const { token = '' } = useParams()
  const { setMe, refresh } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState<InviteState | null>(null)
  /** Why the link does not hold: nexcanvas connected to nexsuite since (B26), expired (G4), or anything else (used,
   * withdrawn, replaced). */
  const [invalid, setInvalid] = useState<'invalid' | 'expired' | 'suite' | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [methods, setMethods] = useState<Methods | null>(null)

  useEffect(() => {
    api<InviteState>(`/api/invite/${encodeURIComponent(token)}`).then(setState, (error) => {
      const code = codeOf(error)
      setInvalid(code === 'invite_suite' ? 'suite' : code === 'invite_expired' ? 'expired' : 'invalid')
    })
    void waysIn().then(setMethods)
  }, [token])

  if (invalid) {
    return (
      <AuthFrame title={invalid === 'expired' ? t('auth.invite.expiredTitle') : t('auth.invite.invalidTitle')}>
        <p className="text-sm text-mist-400">{invalid === 'suite' ? t('errors.invite_suite') : invalid === 'expired' ? t('auth.invite.expiredText') : t('auth.invite.invalidText')}</p>
        <BackLink />
      </AuthFrame>
    )
  }
  // The ways in first, as on the sign-in page: no password form that turns out not to be one.
  if (!state || methods === null) return null
  // Who invites, so the link is not taken for spam (E18, as nextasks).
  const by = state.by ? 'By' : ''
  const text = state.space
    ? t(`auth.invite.intoSpace${by}`, { space: state.space, role: t(`roles.${state.role}`), by: state.by })
    : t(`auth.invite.intoApp${by}`, { by: state.by })

  if (state.signed_in_as && !state.space) {
    // A link for a new account, opened by somebody signed in already: there is nothing to join (F2).
    return (
      <AuthFrame title={t('auth.invite.title')} text={t('auth.invite.haveAccount', { name: state.signed_in_as })}>
        <Link to="/" className="nc-btn nc-btn-accent flex h-10 w-full items-center justify-center">
          {t('auth.invite.toApp')}
        </Link>
      </AuthFrame>
    )
  }

  if (state.signed_in_as) {
    return (
      <AuthFrame title={t('auth.invite.title')} text={text}>
        <Problem code={problem} />
        <button
          type="button"
          className="h-10 w-full rounded-full bg-accent-500 px-4 text-sm font-semibold text-on-accent hover:bg-accent-400"
          onClick={async () => {
            try {
              await api(`/api/invite/${encodeURIComponent(token)}/join`, { method: 'POST' })
              await refresh()
              navigate('/', { replace: true })
            } catch (error) {
              setProblem(codeOf(error))
            }
          }}
        >
          {t('auth.invite.join', { name: state.signed_in_as })}
        </button>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame title={t('auth.invite.title')} text={text}>
      {methods && !methods.password && methods.providers.length === 0 && <p className="text-sm text-mist-400">{t('auth.invite.noWay')}</p>}
      {(!methods || methods.password) && (
        <>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setProblem(null)
            try {
              setMe(await api<Me>(`/api/invite/${encodeURIComponent(token)}`, { method: 'POST', body: { name: name.trim(), password } }))
              navigate('/', { replace: true })
            } catch (error) {
              setProblem(codeOf(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          <Problem code={problem} />
          {/* The rule up front, not after the first refusal (E18). */}
          <Field label={t('auth.invite.name')} value={name} onChange={setName} autoComplete="username" autoFocus hint={t('auth.invite.nameHint')} maxLength={64} />
          <Field label={t('auth.password')} value={password} onChange={setPassword} type="password" autoComplete="new-password" hint={t('auth.passwordHint')} />
          <Primary busy={busy}>{t('auth.invite.submit')}</Primary>
        </form>
        </>
      )}
      {/* Through a sign-in provider (a1-9, C9, blueprint 04): the invitation is the permission for the new account,
          it travels along to the provider. */}
      <ProviderButtons providers={methods?.providers ?? []} invite={token} withOr={!methods || methods.password} />
    </AuthFrame>
  )
}

/** The way back from a page behind a link that does not hold (G3). */
function BackLink() {
  const { t } = useTranslation()
  return (
    <Link to="/login" className="nc-btn nc-btn-ghost mt-4 flex h-10 w-full items-center justify-center">
      {t('auth.backToLogin')}
    </Link>
  )
}
