// A board takes the whole height (Discussion #1, 0.8.0: a projector in class has little of it): the app's header stays
// on the other pages, over a board its own small bars float instead.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import i18n from '../i18n'
import { AppShell } from './AppShell'

vi.mock('../state/auth', () => ({ useAuth: () => ({ me: { id: 1, name: 'anna', role: 'member', sign_in: 'password', two_factor: true, preferences: {} } }) }))
vi.mock('../board/store', async (original) => ({
  ...(await original<typeof import('../board/store')>()),
  useBoards: () => ({ spaces: [], boards: [], loaded: true }),
}))

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })))
  await i18n.changeLanguage('en')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function at(path: string) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<p>boards</p>} />
            <Route path="b/:id" element={<p>board</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    ),
  )
  return host.querySelector('header')!
}

describe('the header of the app', () => {
  it('stands over the list of boards', async () => {
    expect((await at('/')).classList.contains('hidden')).toBe(false)
  })

  it('makes room on a board', async () => {
    expect((await at('/b/abc')).classList.contains('hidden')).toBe(true)
    expect(host.textContent).toContain('board')
  })
})
