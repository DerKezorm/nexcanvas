/**
 * The pages before signing in, as in nexlore: the first account (with the setup code from the server's log),
 * signing in (password, then the second factor; or the provider's button), and accepting an invitation.
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { ApiError, api, authApi, type Me, type Methods } from '../api/client'
import { Logo } from '../components/Logo'
import { ThemeSwitcher } from '../components/ThemeSwitcher'
import i18n from '../i18n'
import { errorText } from '../lib/errors'
import { safeNext, useAuth } from '../state/auth'

function AuthFrame({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
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

function Field({ label, value, onChange, type = 'text', autoComplete, autoFocus = false, hint }: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  autoComplete?: string
  autoFocus?: boolean
  hint?: string
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

function Problem({ code }: { code: string | null }) {
  if (!code) return null
  return (
    <p role="alert" className="rounded-lg border border-bad-500/30 bg-bad-500/10 px-3 py-2 text-sm text-bad-500">
      {errorText(code)}
    </p>
  )
}

const codeOf = (error: unknown) => (error instanceof ApiError ? error.code : 'internal_error')

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

export function LoginPage() {
  const { t } = useTranslation()
  const { status, setMe } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [methods, setMethods] = useState<Methods | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [step, setStep] = useState<'password' | 'code'>('password')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(params.get('error'))
  const next = safeNext(params.get('next'))

  useEffect(() => {
    void authApi.methods().then(setMethods, () => setMethods({ password: true, oidc: false, oidc_name: '' }))
  }, [])

  if (status === 'loading') return null
  if (status === 'setup') return <Navigate to="/setup" replace />
  if (status === 'signedIn') return <Navigate to={next} replace />

  const submit = async () => {
    if (step === 'password' && !name.trim()) return setProblem('name_missing')
    if (step === 'password' && !password) return setProblem('password_missing')
    setBusy(true)
    setProblem(null)
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
          <Problem code={problem} />
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

  return (
    <AuthFrame title={t('auth.login.title')} text={t('auth.login.text')}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Problem code={problem} />
        <Field label={t('auth.name')} value={name} onChange={setName} autoComplete="username" autoFocus />
        <Field label={t('auth.password')} value={password} onChange={setPassword} type="password" autoComplete="current-password" />
        <Primary busy={busy}>{t('auth.login.submit')}</Primary>
        {methods && !methods.password && <p className="text-xs text-mist-500">{t('auth.login.passwordOff')}</p>}
      </form>
      {methods?.oidc && (
        <>
          <div className="my-4 flex items-center gap-3 text-xs text-mist-600">
            <span className="h-px flex-1 bg-ink-700" />
            {t('auth.or')}
            <span className="h-px flex-1 bg-ink-700" />
          </div>
          <a href={`/api/oidc/start?next=${encodeURIComponent(next)}`} className="flex h-10 w-full items-center justify-center rounded-full border border-ink-700 text-sm font-medium hover:bg-ink-850">
            {t('auth.login.oidc', { name: methods.oidc_name || 'OpenID Connect' })}
          </a>
        </>
      )}
    </AuthFrame>
  )
}

type InviteState = { space: string | null; role: string | null; min_password: number; signed_in_as: string | null }

export function InvitePage() {
  const { t } = useTranslation()
  const { token = '' } = useParams()
  const { setMe, refresh } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState<InviteState | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    api<InviteState>(`/api/invite/${encodeURIComponent(token)}`).then(setState, () => setInvalid(true))
  }, [token])

  if (invalid) {
    return (
      <AuthFrame title={t('auth.invite.invalidTitle')}>
        <p className="text-sm text-mist-400">{t('auth.invite.invalidText')}</p>
      </AuthFrame>
    )
  }
  if (!state) return null
  const text = state.space ? t('auth.invite.intoSpace', { space: state.space, role: t(`roles.${state.role}`) }) : t('auth.invite.intoApp')

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
        <Field label={t('auth.name')} value={name} onChange={setName} autoComplete="username" autoFocus />
        <Field label={t('auth.password')} value={password} onChange={setPassword} type="password" autoComplete="new-password" hint={t('auth.passwordHint')} />
        <Primary busy={busy}>{t('auth.invite.submit')}</Primary>
      </form>
    </AuthFrame>
  )
}
