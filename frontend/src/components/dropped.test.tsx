// A space nexsuite no longer gives nexcanvas (B18): only the operator sees it, marked in the side bar with what it
// means, and the space's menu offers the trash and nothing else.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

import i18n from '../i18n'
import { BoardsPage } from '../pages/BoardsPage'
import { Sidebar } from './Sidebar'

const scene = vi.hoisted(() => ({ spaces: [] as Record<string, unknown>[] }))

vi.mock('../state/auth', () => ({ useAuth: () => ({ me: { id: 1, name: 'robin', role: 'operator', suite: 'connected' } }) }))
vi.mock('../lib/notices', async (original) => ({ ...(await original<typeof import('../lib/notices')>()), useNotices: () => [] }))
vi.mock('../board/store', async (original) => ({
  ...(await original<typeof import('../board/store')>()),
  useBoards: () => ({
    boards: [],
    spaces: scene.spaces,
    loaded: true,
    space: (id: number) => scene.spaces.find((space) => space.id === id),
    refresh: async () => undefined,
    trash: async () => undefined,
  }),
}))

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const space = (id: number, name: string, change: Record<string, unknown> = {}) => ({
  id, name, color: '#ff8a70', role: 'manage', boards: 0, members: [], teams: [], managed: true, dropped: false, people: 0, ...change,
})

let root: Root
let host: HTMLElement

async function mount(ui: React.ReactNode, path = '/'): Promise<HTMLElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)
  })
  return host
}

beforeEach(async () => {
  scene.spaces = [space(1, 'Ideen', { dropped: true }), space(2, 'Studio')]
  await i18n.changeLanguage('en')
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('a space nexsuite let go (B18)', () => {
  it('is marked in the side bar with what it means, the others are not', async () => {
    const page = await mount(<Sidebar />)
    const marks = [...page.querySelectorAll('[data-testid="space-dropped"]')]
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('no longer in nexsuite')
    expect(marks[0].getAttribute('title')).toBe(
      'nexsuite no longer gives nexcanvas this space. Its boards stay, only the operator sees it. You can move it to the trash.',
    )
    expect(marks[0].closest('a')!.textContent).toContain('Ideen')
  })

  it('offers the operator only the trash in its menu', async () => {
    const page = await mount(<BoardsPage />, '/?space=1')
    expect(page.querySelector('[data-testid="space-dropped"]')!.textContent).toBe('no longer in nexsuite')
    await act(async () => {
      page.querySelector<HTMLButtonElement>('button[aria-label="Space options"], button[title="Space options"]')?.click()
    })
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())
    expect(items).toEqual(['Move space to trash'])
  })
})
