/**
 * Who is signed in. `loading` until the server answered, `setup` while nexcanvas has no account yet, `signedOut`,
 * or `signedIn` with the account. A request that finds the session gone sends `SIGNED_OUT_EVENT`; then `ended` is set, so
 * the sign-in can say why (blocked, signed out everywhere; A8 of the check on 05.10.2026). While signed in, the page asks
 * after its session every `SESSION_MS`, so that this happens within seconds and not at the next full load.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { ApiError, authApi, SIGNED_OUT_EVENT, type Me } from '../api/client'
import i18n, { changeLanguage } from '../i18n'

type Status = 'loading' | 'setup' | 'signedOut' | 'signedIn'

type Auth = {
  status: Status
  me: Me | null
  /** The session ended while the page was open (not by signing out here). */
  ended: boolean
  refresh: () => Promise<void>
  setMe: (me: Me) => void
  signOut: () => Promise<void>
}

const Context = createContext<Auth | null>(null)

/** How often an open page asks whether its session still holds: a block or "sign out everywhere" shows within seconds,
 * with the reason on the sign-in page (A8). The answer is small; only a 401 changes anything. */
export const SESSION_MS = 5_000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [me, setMeState] = useState<Me | null>(null)
  const [ended, setEnded] = useState(false)

  const setMe = useCallback((next: Me) => {
    setMeState(next)
    setEnded(false)
    setStatus('signedIn')
    // The account's language wins over the browser's.
    if (next.language && next.language !== i18n.language) void changeLanguage(next.language)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const state = await authApi.setupState()
      if (state.needs_setup) {
        setStatus('setup')
        return
      }
      if (!state.signed_in) {
        setStatus('signedOut')
        setMeState(null)
        return
      }
      setMe(await authApi.me())
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setStatus('signedOut')
        setMeState(null)
      } else {
        // The server is not reachable: keep trying, the page shows the sign-in meanwhile.
        setStatus('signedOut')
      }
    }
  }, [setMe])

  useEffect(() => {
    void refresh()
    const gone = () => {
      setEnded(true)
      setStatus('signedOut')
      setMeState(null)
    }
    window.addEventListener(SIGNED_OUT_EVENT, gone)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, gone)
  }, [refresh])

  useEffect(() => {
    if (status !== 'signedIn') return
    // A 401 sends SIGNED_OUT_EVENT (api/client.ts); anything else, such as the server restarting, changes nothing.
    const session = window.setInterval(() => document.visibilityState === 'visible' && void authApi.me().catch(() => undefined), SESSION_MS)
    return () => window.clearInterval(session)
  }, [status])

  const signOut = useCallback(async () => {
    await authApi.logout().catch(() => undefined)
    setEnded(false)
    setMeState(null)
    setStatus('signedOut')
  }, [])

  const value = useMemo(() => ({ status, me, ended, refresh, setMe, signOut }), [status, me, ended, refresh, setMe, signOut])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): Auth {
  const value = useContext(Context)
  if (!value) throw new Error('useAuth outside AuthProvider')
  return value
}

/** Only addresses inside nexcanvas, so a link cannot send someone elsewhere after signing in. */
// eslint-disable-next-line react-refresh/only-export-components
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/'
}
