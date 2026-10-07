import { useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { BoardsProvider, useBoards } from './board/store'
import { AppShell } from './components/AppShell'
import { InvitePage, LoginPage, SetupPage } from './pages/AuthPages'
import { BoardPage } from './pages/BoardPage'
import { BoardsPage } from './pages/BoardsPage'
import { FilesPage } from './pages/FilesPage'
import { PublicPage } from './pages/PublicPage'
import { AboutPage } from './pages/AboutPage'
import { AccountPage } from './pages/AccountPage'
import { SettingsPage } from './pages/SettingsPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { useAuth } from './state/auth'
import { NotFoundPage } from './components/NotFound'

/** Everything behind the sign-in: without an account the page goes to the sign-in, and comes back after. An account
 * that still has to set up its second factor (the operator requires one) reaches its own account page only; before,
 * it saw an empty app with no way on (Prüfgang 04.10.2026, F1). */
function SignedIn({ children }: { children: ReactNode }) {
  const { status, me, ended } = useAuth()
  const location = useLocation()
  if (status === 'loading') return null
  if (status === 'setup') return <Navigate to="/setup" replace />
  // Ended while open (blocked, signed out everywhere): the sign-in says why (`auth.login.ended`).
  if (status === 'signedOut') return <Navigate to={`/login?${ended ? 'ended=1&' : ''}next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (me?.second_factor_setup_required && location.pathname !== '/account') return <Navigate to="/account?tab=security" replace />
  return (
    <BoardsProvider>
      <StartAtLast />
      {children}
    </BoardsProvider>
  )
}

/** Once per visit: whoever chose "the board open last" as their start page lands there instead of the overview. */
let started = false
function StartAtLast() {
  const { me } = useAuth()
  const { loaded, boards } = useBoards()
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (started || !loaded) return
    started = true
    if (location.pathname !== '/' || location.search || me?.preferences?.start !== 'last') return
    const last = boards.filter((b) => b.opened > 0).sort((a, b) => b.opened - a.opened)[0]
    if (last) navigate(`/b/${last.id}`, { replace: true })
  }, [loaded, boards, me, location, navigate])
  return null
}

export default function App() {
  return (
    <Routes>
      <Route path="setup" element={<SetupPage />} />
      <Route path="login" element={<LoginPage />} />
      <Route path="notzugang" element={<LoginPage emergency />} />
      <Route path="invite/:token" element={<InvitePage />} />
      <Route path="s/:token" element={<PublicPage />} />
      <Route
        element={
          <SignedIn>
            <AppShell />
          </SignedIn>
        }
      >
        <Route index element={<BoardsPage />} />
        <Route path="b/:id" element={<BoardPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="files" element={<FilesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="about" element={<AboutPage />} />
        {/* An address no page answers to says so, instead of silently showing the overview (E31). */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
