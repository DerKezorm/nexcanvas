/** The account menu offers the languages by their names, an added one in its place (decided 06.10.2026). */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

import { forgetAddedLanguages } from '../i18n'
import { AccountMenu } from './AccountMenu'

const me = { id: 1, name: 'robin', display_name: 'Robin', avatar: null, role: 'operator' }

vi.mock('../state/auth', () => ({ useAuth: () => ({ me, setMe: () => undefined, signOut: async () => undefined }) }))
vi.mock('../lib/notices', async (original) => ({ ...(await original<typeof import('../lib/notices')>()), useNotices: () => [] }))

let root: Root
let box: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/locales'
        ? new Response(JSON.stringify([{ code: 'fr', name: 'Français', keys: 1 }, { code: 'af', name: 'Afrikaans', keys: 1 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response('{}', { status: 404 }),
    ),
  )
  forgetAddedLanguages()
  box = document.createElement('div')
  document.body.append(box)
  root = createRoot(box)
})

afterEach(() => {
  act(() => root.unmount())
  box.remove()
  vi.unstubAllGlobals()
  forgetAddedLanguages()
})

describe('the account menu', () => {
  it('lists the languages by name, an added one in its place among the shipped ones', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AccountMenu />
        </MemoryRouter>,
      )
    })
    await act(async () => {
      box.querySelector<HTMLButtonElement>('button[aria-haspopup]')!.click()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const names = [...box.querySelectorAll('select option')].map((option) => option.textContent)
    expect(names).toEqual(['Afrikaans', 'Deutsch', 'English', 'Français'])
  })
})
