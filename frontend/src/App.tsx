import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { BoardsProvider } from './board/store'
import { AppShell } from './components/AppShell'
import { InvitePage, LoginPage, SetupPage } from './pages/AuthPages'
import { BoardPage } from './pages/BoardPage'
import { BoardsPage } from './pages/BoardsPage'
import { FilesPage } from './pages/FilesPage'
import { PublicPage } from './pages/PublicPage'
import { AccountPage, SettingsPage } from './pages/SettingsPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { useAuth } from './state/auth'

/** Everything behind the sign-in: without an account the page goes to the sign-in, and comes back after. */
function SignedIn({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return null
  if (status === 'setup') return <Navigate to="/setup" replace />
  if (status === 'signedOut') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return <BoardsProvider>{children}</BoardsProvider>
}

export default function App() {
  return (
    <Routes>
      <Route path="setup" element={<SetupPage />} />
      <Route path="login" element={<LoginPage />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
