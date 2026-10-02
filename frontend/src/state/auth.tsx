/**
 * Who is signed in. `loading` until the server answered, `setup` while nexcanvas has no account yet, `signedOut`,
 * or `signedIn` with the account. A request that finds the session gone sends `SIGNED_OUT_EVENT`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { ApiError, authApi, SIGNED_OUT_EVENT, type Me } from '../api/client'
import i18n, { changeLanguage } from '../i18n'

type Status = 'loading' | 'setup' | 'signedOut' | 'signedIn'

type Auth = {
  status: Status
  me: Me | null
  refresh: () => Promise<void>
  setMe: (me: Me) => void
  signOut: () => Promise<void>
}

const Context = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [me, setMeState] = useState<Me | null>(null)

  const setMe = useCallback((next: Me) => {
    setMeState(next)
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
      setStatus('signedOut')
      setMeState(null)
    }
    window.addEventListener(SIGNED_OUT_EVENT, gone)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, gone)
  }, [refresh])

  const signOut = useCallback(async () => {
    await authApi.logout().catch(() => undefined)
    setMeState(null)
    setStatus('signedOut')
  }, [])

  const value = useMemo(() => ({ status, me, refresh, setMe, signOut }), [status, me, refresh, setMe, signOut])
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
