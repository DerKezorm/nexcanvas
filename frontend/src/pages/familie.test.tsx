/**
 * Prüfgang 05.10.2026 for nexcanvas, block 4 (words and looks), as nextasks and nexbrand have them: the account list
 * (G6), readable letters and status colours in both themes (G7), worded backup buttons (G10), the family's names and
 * one way to write a moment (G11), the invitation page (E18, G4), limits said in the field (E21), links into nothing
 * (E31), the tab's title (F13) and a person without a space (G5).
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { letterColors } from '../components/Avatar'
import { COLORS } from '../board/canvas/Peers'
import { SPACE_COLORS } from '../components/NewSpaceDialog'
import i18n from '../i18n'
import { moment } from '../lib/time'
import { pageTitle } from '../lib/title'

type Answer = { status: number; body: unknown }
type Handler = (method: string, path: string, body: unknown) => Answer | undefined

let handler: Handler = () => undefined
/** While set, the ways in (`/api/auth/methods`) wait for it: the page must show no form before they are known. */
let held: Promise<void> | null = null
const calls: { method: string; path: string; body: unknown }[] = []

const scene = vi.hoisted(() => ({
  me: { id: 1, name: 'robin', display_name: 'Robin', avatar: null, role: 'operator', sign_in: 'password', suite: '', mail: true } as Record<string, unknown> | null,
  spaces: [] as Record<string, unknown>[],
  boards: [] as Record<string, unknown>[],
  loaded: true,
  status: 'signedIn' as string,
  patch: (async () => undefined) as (id: string, change: Record<string, unknown>) => Promise<void>,
}))

vi.mock('../state/auth', async (original) => ({
  ...(await original<typeof import('../state/auth')>()),
  useAuth: () => ({ me: scene.me, status: scene.status, setMe: () => undefined, refresh: async () => undefined, signOut: async () => undefined }),
}))
vi.mock('../lib/notices', async (original) => ({ ...(await original<typeof import('../lib/notices')>()), useNotices: () => [] }))
vi.mock('../board/store', async (original) => ({
  ...(await original<typeof import('../board/store')>()),
  useBoards: () => ({
    boards: scene.boards,
    spaces: scene.spaces,
    bin: [],
    loaded: scene.loaded,
    board: (id: string) => scene.boards.find((board) => board.id === id),
    space: (id: number) => scene.spaces.find((space) => space.id === id),
    refresh: async () => undefined,
    loadBin: async () => undefined,
    patch: (id: string, change: Record<string, unknown>) => scene.patch(id, change),
  }),
}))

let root: Root
let box: HTMLDivElement

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0
  handler = () => undefined
  scene.me = { id: 1, name: 'robin', display_name: 'Robin', avatar: null, role: 'operator', sign_in: 'password', suite: '', mail: true }
  scene.spaces = []
  scene.boards = []
  scene.loaded = true
  scene.status = 'signedIn'
  held = null
  scene.patch = async () => undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ method, path, body })
      if (path === '/api/auth/methods' && held) await held
      const answer = handler(method, path, body) ?? { status: 404, body: { detail: { code: 'not_found' } } }
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } })
    }),
  )
  box = document.createElement('div')
  document.body.append(box)
  root = createRoot(box)
  await i18n.changeLanguage('en')
})

afterEach(() => {
  act(() => root.unmount())
  box.remove()
  vi.unstubAllGlobals()
})

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await act(async () => await Promise.resolve())
}

async function render(node: React.ReactNode, at = '/'): Promise<void> {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[at]}>{node}</MemoryRouter>)
  })
  await settle()
}

const space = (id: number, name: string, change: Record<string, unknown> = {}) => ({
  id, name, color: '#ff8a70', role: 'manage', boards: 0, members: [], teams: [], managed: false, dropped: false, people: 1, ...change,
})

const accounts = [
  { id: 1, name: 'robin', display_name: 'Robin', avatar: null, role: 'operator', sign_in: 'password', spaces: 1, locked: false, created_at: '', last_seen_at: null },
  { id: 2, name: 'alex', display_name: 'Alex', avatar: null, role: 'member', sign_in: 'password', spaces: 1, locked: false, created_at: '', last_seen_at: null },
  { id: 3, name: 'kim', display_name: '', avatar: null, role: 'member', sign_in: 'oidc', spaces: 0, locked: false, created_at: '', last_seen_at: null },
]

describe('the account list (G6, H4)', () => {
  it('says the operator sees every space, names the account in each button and marks blocking as danger', async () => {
    const { AccountsCard } = await import('./settings/ServerCards')
    handler = (_m, path) => (path === '/api/accounts' ? { status: 200, body: accounts } : path === '/api/invites' ? { status: 200, body: [] } : undefined)
    await render(<AccountsCard />)
    const status = (name: string) => box.querySelector(`[data-testid="account-row-${name}"] [data-testid="account-status"]`)
    expect(status('robin')?.textContent).toContain('sees and manages every space')
    expect(status('alex')?.textContent).toContain('in one space')
    // The line wraps instead of being cut off ("in eine..." at 1440 px).
    expect(status('alex')?.className).not.toContain('truncate')
    // The name line too: the sign-in name after a long display name stays readable on a phone.
    expect(box.querySelector('[data-testid="account-row-alex"] [data-testid="account-name"]')?.className).not.toContain('truncate')
    const row = box.querySelector('[data-testid="account-row-alex"]')!
    const labels = [...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
    expect(labels.length).toBeGreaterThanOrEqual(4)
    expect(labels.every((label) => label?.startsWith('Alex: '))).toBe(true)
    expect(labels).toContain('Alex: Block')
    expect(labels).toContain('Alex: Delete')
    const block = [...row.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Alex: Block')!
    expect(block.className).toContain('hover:text-bad-500')
    // Without a display name the button names the sign-in name.
    const kim = box.querySelector('[data-testid="account-row-kim"]')!
    expect([...kim.querySelectorAll('button')].every((b) => b.getAttribute('aria-label')?.startsWith('kim: '))).toBe(true)
  })

  it('shows accounts connected to nexsuite as signing in through nexsuite', async () => {
    const { AccountsCard } = await import('./settings/ServerCards')
    handler = (_m, path) => (path === '/api/accounts' ? { status: 200, body: accounts } : undefined)
    await render(<AccountsCard readOnly />)
    const status = (name: string) => box.querySelector(`[data-testid="account-row-${name}"] [data-testid="account-status"]`)?.textContent
    expect(status('kim')).toContain('nexsuite')
    expect(status('kim')).not.toContain('provider')
  })

  it('asks before deleting with the display name, the family sentence and "Your password"', async () => {
    const { AccountsCard } = await import('./settings/ServerCards')
    handler = (_m, path) => (path === '/api/accounts' ? { status: 200, body: accounts } : path === '/api/invites' ? { status: 200, body: [] } : undefined)
    await render(<AccountsCard />)
    const remove = [...box.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Alex: Delete')!
    await act(async () => remove.click())
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Delete Alex?')
    expect(dialog.textContent).toContain('The account is deleted and cannot be brought back.')
    expect(dialog.querySelector('input[type="password"]')?.getAttribute('placeholder')).toBe('Your password')
  })
})

describe('the operator invites straight into a space (E18)', () => {
  it('offers the spaces, sends space and right, and lists where an open invitation leads', async () => {
    const { AccountsCard } = await import('./settings/ServerCards')
    scene.spaces = [space(4, 'Ideen'), space(5, 'Studio')]
    const open = [{ id: 9, email: '', expires_at: '2026-10-14T10:00:00Z', space: 'Ideen', role: 'write' }]
    handler = (method, path) => {
      if (path === '/api/accounts') return { status: 200, body: accounts }
      if (path === '/api/invites' && method === 'GET') return { status: 200, body: open }
      if (path === '/api/invites' && method === 'POST') return { status: 201, body: { link: 'https://canvas.example.com/invite/x', sent: false, email: '' } }
      return undefined
    }
    await render(<AccountsCard />)
    expect(box.querySelector('[data-testid="open-invites"]')?.textContent).toContain('into “Ideen” (Write)')
    const into = [...box.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent === 'None, into nexcanvas only'))!
    expect([...into.options].map((o) => o.textContent)).toEqual(['None, into nexcanvas only', 'Ideen', 'Studio'])
    await act(async () => {
      into.value = '5'
      into.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const create = [...box.querySelectorAll('button')].find((b) => b.textContent === 'Create invitation link')!
    await act(async () => create.click())
    await settle()
    const sent = calls.find((call) => call.method === 'POST' && call.path === '/api/invites')
    expect(sent?.body).toMatchObject({ space: 5, role: 'write' })
  })

  it('sends no space when none is chosen', async () => {
    const { AccountsCard } = await import('./settings/ServerCards')
    scene.spaces = [space(4, 'Ideen')]
    handler = (method, path) => {
      if (path === '/api/accounts') return { status: 200, body: accounts }
      if (path === '/api/invites' && method === 'GET') return { status: 200, body: [] }
      if (path === '/api/invites' && method === 'POST') return { status: 201, body: { link: 'https://canvas.example.com/invite/x', sent: false, email: '' } }
      return undefined
    }
    await render(<AccountsCard />)
    const create = [...box.querySelectorAll('button')].find((b) => b.textContent === 'Create invitation link')!
    await act(async () => create.click())
    await settle()
    const sent = calls.find((call) => call.method === 'POST' && call.path === '/api/invites')
    expect(sent?.body).not.toHaveProperty('space')
    expect(sent?.body).not.toHaveProperty('role')
  })
})

describe('the invitation page (E18, G4)', () => {
  async function invitation(answer: Answer) {
    const { InvitePage } = await import('./AuthPages')
    scene.me = null
    handler = (_m, path) => {
      if (path.startsWith('/api/invite/')) return answer
      if (path === '/api/auth/methods') return { status: 200, body: { password: true, oidc: false, oidc_name: '' } }
      return undefined
    }
    // A fresh page each time: the same one would keep the answer it already has.
    act(() => root.unmount())
    root = createRoot(box)
    await render(
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
      </Routes>,
      '/invite/abc',
    )
  }

  it('names who invites, into a space and into nexcanvas', async () => {
    await invitation({ status: 200, body: { space: 'Ideen', role: 'write', by: 'Robin Keller', min_password: 12, signed_in_as: null } })
    expect(box.textContent).toContain('Robin Keller invites you into the space “Ideen” (Write).')
    await invitation({ status: 200, body: { space: null, role: null, by: 'Robin Keller', min_password: 12, signed_in_as: null } })
    expect(box.textContent).toContain('Robin Keller invites you to nexcanvas.')
  })

  it('says the rule for the sign-in name before the first refusal', async () => {
    await invitation({ status: 200, body: { space: null, role: null, by: 'Robin', min_password: 12, signed_in_as: null } })
    const name = [...box.querySelectorAll('label')].find((label) => label.textContent?.startsWith('Sign-in name'))
    expect(name).toBeDefined()
    const hint = document.getElementById(name!.querySelector('input')!.getAttribute('aria-describedby') ?? '')
    expect(hint?.textContent).toBe(i18n.t('auth.invite.nameHint'))
  })

  it('says an expired link expired, and any other that it is not valid any more', async () => {
    await invitation({ status: 404, body: { detail: { code: 'invite_expired' } } })
    expect(box.textContent).toContain('Invitation expired')
    expect(box.textContent).toContain('This invitation has expired. Ask for a new one.')
    await invitation({ status: 404, body: { detail: { code: 'invite_invalid' } } })
    expect(box.textContent).toContain('Invitation not valid')
    expect(box.textContent).not.toContain('expired.')
  })
})

/** Contrast of two colours as WCAG counts it. */
function contrast(a: number[], b: number[]): number {
  const lum = (c: number[]) => {
    const [r, g, bl] = c.map((v) => {
      const x = v / 255
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const hex = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16))
/** `color-mix(in srgb, <colour> <p>%, var(--color-x))` with the theme's value of the variable. */
function mixed(css: string, tokens: Record<string, string>): number[] {
  const m = css.match(/color-mix\(in srgb, (#[0-9a-f]{6}) (\d+)%, var\((--[\w-]+)\)\)/)!
  const p = Number(m[2]) / 100
  const [a, b] = [hex(m[1]), hex(tokens[m[3]])]
  return a.map((v, i) => v * p + b[i] * (1 - p))
}

/** The colour tokens of both themes, as index.css sets them: dark in `@theme`, light under `data-theme='light'`. */
async function themeTokens(): Promise<{ dark: Record<string, string>; light: Record<string, string> }> {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync: (path: string, encoding: string) => string }
  const css = fs.readFileSync('src/styles/index.css', 'utf8')
  const block = (start: string) => {
    const at = css.indexOf(start)
    expect(at, start).toBeGreaterThanOrEqual(0)
    return css.slice(at, css.indexOf('}', at))
  }
  const tokens = (text: string) => Object.fromEntries([...text.matchAll(/(--color-[\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]))
  const dark = tokens(block('@theme {'))
  return { dark, light: { ...dark, ...tokens(block(":root[data-theme='light'] {")) } }
}

describe('letters in circles and team squares in both themes (G7)', () => {
  it('read 4.5 to 1 or more for every person and team colour, measured with the theme tokens', async () => {
    const { dark, light } = await themeTokens()
    const colours = new Set([...COLORS, ...SPACE_COLORS])
    expect(colours.size).toBeGreaterThanOrEqual(10)
    for (const [theme, values] of [['dark', dark], ['light', light]] as const)
      for (const colour of colours) {
        const look = letterColors(colour)
        expect(contrast(mixed(look.color, values), mixed(look.background, values)), `${theme} ${colour}`).toBeGreaterThanOrEqual(4.5)
      }
  })

  it('are drawn with those colours, a person and a team alike', async () => {
    const { Avatar } = await import('../components/Avatar')
    const { TeamBadge } = await import('../components/Teams')
    await render(
      <>
        <Avatar person={{ id: 2, name: 'alex', avatar: null }} />
        <TeamBadge team={{ name: 'Netz', color: '#fbbf24' }} />
      </>,
    )
    const [circle, square] = [...box.querySelectorAll('span')]
    expect(circle.style.color).toMatch(/^color-mix/)
    expect(square.style.color).toBe(letterColors('#fbbf24').color)
  })

  it('the chosen tab or row reads 4.5 to 1 or more on its wash, over every ground', async () => {
    const { dark, light } = await themeTokens()
    for (const [theme, values] of [['dark', dark], ['light', light]] as const)
      for (const ground of ['--color-ink-950', '--color-ink-900', '--color-ink-800']) {
        // bg-accent-500/15 text-accent-400 (tabs, the main menu, a chosen size)
        const under = hex(values[ground])
        const wash = hex(values['--color-accent-500']).map((v, i) => v * 0.15 + under[i] * 0.85)
        expect(contrast(hex(values['--color-accent-400']), wash), `${theme} on ${ground}`).toBeGreaterThanOrEqual(4.5)
      }
  })

  it('status words read 4.5 to 1 or more on the card and on their own tint', async () => {
    const { dark, light } = await themeTokens()
    expect(light['--color-ok-500']).toBe('#166534')
    expect(light['--color-warn-500']).toBe('#92400e')
    expect(light['--color-bad-500']).toBe('#b91c3c')
    for (const [theme, values] of [['dark', dark], ['light', light]] as const)
      for (const tone of ['ok', 'warn', 'bad']) {
        const text = hex(values[`--color-${tone}-500`])
        const card = hex(values['--color-ink-900'])
        const tint = text.map((v, i) => v * 0.1 + card[i] * 0.9)
        expect(contrast(text, card), `${theme} ${tone} on the card`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(text, tint), `${theme} ${tone} on its tint`).toBeGreaterThanOrEqual(4.5)
      }
  })
})

describe('the backup list (G10, G11)', () => {
  it('has worded buttons, each naming its backup, and a time without seconds', async () => {
    const { BackupsCard, useServerSettings } = await import('./settings/ServerCards')
    function Backups() {
      return <BackupsCard server={useServerSettings()} />
    }
    handler = (_m, path) => {
      if (path === '/api/settings') return { status: 200, body: { backup_schedule: 'off', backup_keep: 7 } }
      if (path === '/api/backups') return { status: 200, body: [{ name: 'b1.zip', created: '2026-10-04T20:35:59Z', kind: 'manual', note: '', boards: 3, files: 1, size: 2048, version: '0.2.2' }] }
      return undefined
    }
    await render(<Backups />)
    const row = box.querySelector('ul li')!
    const words = [...row.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(words).toEqual(['Check', 'Download', 'Restore', 'Delete'])
    for (const b of row.querySelectorAll('button')) expect(b.getAttribute('aria-label')).toMatch(/^\d.*: \w/)
    expect(row.textContent).not.toMatch(/:\d\d:\d\d/)
    expect(row.textContent).toContain(moment('2026-10-04T20:35:59Z', 'en'))
  })
})

describe('the family (G11, F13)', () => {
  it('writes a moment one way, the log with seconds', () => {
    const when = '2026-10-04T20:35:59Z'
    expect(moment(when, 'de')).not.toMatch(/:\d\d:\d\d/)
    expect(moment(when, 'de')).toMatch(/^\d{1,2}\.\d{1,2}\.2026, \d\d:\d\d$/)
    expect(moment(when, 'de', true)).toMatch(/^\d{1,2}\.\d{1,2}\.2026, \d\d:\d\d:59$/)
  })

  it('names the header like nexsuite, nextasks and nexbrand', async () => {
    await i18n.changeLanguage('de')
    expect([i18n.t('app.home'), i18n.t('account.menu', { name: 'Robin' }), i18n.t('search.button'), i18n.t('theme.group')]).toEqual([
      'Zur Startseite', 'Konto von Robin', 'Suchen', 'Hell oder dunkel',
    ])
  })

  it('names the board or the page in the tab', () => {
    expect(pageTitle('Ideen')).toBe('Ideen · nexcanvas')
    expect(pageTitle('')).toBe('nexcanvas')
    expect(pageTitle(null)).toBe('nexcanvas')
  })
})

describe('links into nothing (E31) and a person without a space (G5)', () => {
  it('a space that is not there says so with the way to all boards', async () => {
    const { BoardsPage } = await import('./BoardsPage')
    scene.spaces = [space(4, 'Ideen')]
    await render(<BoardsPage />, '/?space=77')
    const missing = box.querySelector('[data-testid="not-found"]')
    expect(missing?.textContent).toContain('This space does not exist, is in the trash, or you may not see it.')
    expect(missing?.querySelector('a')?.getAttribute('href')).toBe('/')
    expect(box.querySelector('h1')?.textContent).not.toBe('All boards')
  })

  it('waits for the spaces before it says so', async () => {
    const { BoardsPage } = await import('./BoardsPage')
    scene.loaded = false
    await render(<BoardsPage />, '/?space=77')
    expect(box.querySelector('[data-testid="not-found"]')).toBeNull()
  })

  it('an address nexcanvas does not know says so too', async () => {
    const { NotFoundPage } = await import('../components/NotFound')
    await render(<NotFoundPage />, '/no/such/page')
    expect(box.querySelector('[data-testid="not-found"]')?.textContent).toContain('This page does not exist in nexcanvas.')
  })

  it('tells somebody without a space whom to ask, alone and connected', async () => {
    const { BoardsPage } = await import('./BoardsPage')
    scene.me = { ...scene.me!, role: 'member' }
    await render(<BoardsPage />)
    expect(box.querySelector('[data-testid="no-space"]')?.textContent).toContain(i18n.t('boards.noSpace'))
    scene.me = { ...scene.me!, suite: 'connected' }
    await render(<BoardsPage />)
    expect(box.querySelector('[data-testid="no-space"]')?.textContent).toContain(i18n.t('boards.noSpaceSuite'))
    scene.spaces = [space(4, 'Ideen')]
    await render(<BoardsPage />)
    expect(box.querySelector('[data-testid="no-space"]')).toBeNull()
  })
})

describe('limits said in the field (E21)', () => {
  it('the display name field knows its limit and keeps what was typed when refused', async () => {
    const { AccountPage } = await import('./AccountPage')
    handler = (method, path) => {
      if (path === '/api/me/profile' && method === 'PUT') return { status: 422, body: { detail: { code: 'display_name_too_long', maximum: 80 } } }
      if (path === '/api/auth/methods') return { status: 200, body: { password: true, oidc: false, oidc_name: '' } }
      return undefined
    }
    await render(<AccountPage />, '/account')
    const field = [...box.querySelectorAll('label')].find((label) => label.textContent?.startsWith('Display name'))!.querySelector('input')!
    expect(field.maxLength).toBe(80)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Robin der Zweite')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => field.form!.requestSubmit())
    await settle()
    // The sentence with its number, and the field keeps what was typed.
    expect(box.textContent).toContain('The display name is too long, at most 80 characters.')
    expect(field.value).toBe('Robin der Zweite')
  })

  it('renaming a board knows the limit, and a refusal keeps the dialog and what was typed', async () => {
    const { RenameDialog } = await import('./BoardsPage')
    const board = { id: 'b1', title: 'Ideen', space: 4 } as never
    let closed = false
    const { ApiError } = await import('../api/client')
    scene.patch = async () => Promise.reject(new ApiError(422, 'invalid_title'))
    await render(<RenameDialog board={board} onClose={() => (closed = true)} />)
    const field = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
    expect(field.maxLength).toBe(200)
    await act(async () => document.querySelector<HTMLFormElement>('[role="dialog"] form')!.requestSubmit())
    await settle()
    expect(closed).toBe(false)
    expect(field.value).toBe('Ideen')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(i18n.t('errors.invalid_title'))
  })
})

describe('the sign-in and invitation pages before the ways in are known (as nextasks 52237bf)', () => {
  function hold(): () => void {
    let release = () => undefined as void
    held = new Promise<void>((done) => (release = done))
    return release
  }

  it('the sign-in page shows no password form that connected turns into the nexsuite button', async () => {
    const { LoginPage } = await import('./AuthPages')
    scene.me = null
    scene.status = 'signedOut'
    handler = (_m, path) => (path === '/api/auth/methods' ? { status: 200, body: { password: true, oidc: true, oidc_name: 'nexsuite', suite: true, suite_url: 'https://suite.example.com' } } : undefined)
    const release = hold()
    await render(<LoginPage />, '/login')
    expect(box.querySelector('input[type="password"]')).toBeNull()
    expect(box.textContent).toBe('')
    release()
    await settle()
    expect(box.querySelector('input[type="password"]')).toBeNull()
    expect(box.querySelector('a[href^="/api/oidc/start"]')).not.toBeNull()
  })

  it('the invitation waits for them too, and then shows only the way that is there', async () => {
    const { InvitePage } = await import('./AuthPages')
    scene.me = null
    scene.status = 'signedOut'
    handler = (_m, path) => {
      if (path.startsWith('/api/invite/')) return { status: 200, body: { space: null, role: null, by: 'Robin', min_password: 12, signed_in_as: null } }
      if (path === '/api/auth/methods') return { status: 200, body: { password: false, oidc: true, oidc_name: 'authentik' } }
      return undefined
    }
    const release = hold()
    await render(
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
      </Routes>,
      '/invite/abc',
    )
    expect(calls.some((call) => call.path.startsWith('/api/invite/'))).toBe(true)
    expect(box.querySelector('input[type="password"]')).toBeNull()
    expect(box.textContent).toBe('')
    release()
    await settle()
    expect(box.querySelector('input[type="password"]')).toBeNull()
    expect(box.textContent).toContain('Accept with authentik')
  })
})

describe('a refusal in the settings says the numbers it names (useAction)', () => {
  it('passes the server\'s values to the sentence, not "{{max_mb}}"', async () => {
    const { FilesCard, useServerSettings } = await import('./settings/ServerCards')
    function Files() {
      return <FilesCard server={useServerSettings()} />
    }
    handler = (method, path) => {
      if (path === '/api/settings' && method === 'GET') return { status: 200, body: { upload_max_mb: 50, upload_ceiling_mb: 100, strip_location: true } }
      if (path === '/api/settings' && method === 'PUT') return { status: 413, body: { detail: { code: 'too_large', message: 'The request is too large.', max_mb: 16 } } }
      return undefined
    }
    await render(<Files />)
    const save = [...box.querySelectorAll('button')].find((b) => b.textContent === 'Save')!
    await act(async () => save.click())
    await settle()
    const alert = box.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe(i18n.t('errors.too_large', { max_mb: 16 }))
    expect(alert?.textContent).toContain('16 MB')
    expect(alert?.textContent).not.toContain('{{')
  })

  it('a code of the page itself still reads as before', async () => {
    const { Feedback } = await import('./settings/ui')
    await render(<Feedback problem="network" />)
    expect(box.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('errors.network'))
  })
})
