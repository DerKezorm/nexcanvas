import { Route, Routes } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { BoardPage } from './pages/BoardPage'
import { BoardsPage } from './pages/BoardsPage'
import { FilesPage } from './pages/FilesPage'
import { AccountPage, SettingsPage } from './pages/SettingsPage'
import { TemplatesPage } from './pages/TemplatesPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<BoardsPage />} />
        <Route path="b/:id" element={<BoardPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="files" element={<FilesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<BoardsPage />} />
      </Route>
    </Routes>
  )
}
