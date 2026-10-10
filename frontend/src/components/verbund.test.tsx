// Connecting to nexsuite and living with it, as nextasks and nexbrand learnt it in the check of 05.10.2026: what the
// assistant says about each account (B8, B16), that it keeps the choices (B23), says what takes a moment (B25), loads
// the lists anew when nexsuite lost something chosen (B9), fits a phone (G9); the disconnect dialog (B17); the
// sign-in page (B11, B12), an old invitation (B26), the account page (G3), the mail card (G8), the backups (B15).
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import i18n from '../i18n'
import { AccountPage } from '../pages/AccountPage'
import { InvitePage, LoginPage } from '../pages/AuthPages'
import { BackupsCard, MailCard } from '../pages/settings/ServerCards'
import { SuiteCard } from './Suite'

const auth = vi.hoisted(() => ({ me: {} as Record<string, unknown>, status: 'signedIn' }))
vi.mock('../state/auth', () => ({
  useAuth: () => ({ me: auth.me, status: auth.status, setMe: () => undefined, refresh: async () => undefined, signOut: async () => undefined }),
  safeNext: (next: string | null) => next ?? '/',
}))

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// --- A small server: answers by "METHOD /path", every call kept, one kind refused or held back on request -----------

type Answer = unknown | ((body: unknown) => unknown)
const server = {
  answers: {} as Record<string, Answer>,
  calls: [] as { key: string; body: unknown }[],
  refuse: {} as Record<string, { status: number; code: string }>,
  gates: {} as Record<string, Promise<void>>,
  pending: 0,
}

function calls(key: string) {
  return server.calls.filter((call) => call.key === key)
}

/** Holds every answer of a kind back until the returned function is called. */
function hold(key: string): () => void {
  let release = () => undefined as void
  server.gates[key] = new Promise<void>((resolve) => {
    release = resolve
  })
  return () => {
    delete server.gates[key]
    release()
  }
}

const json = (status: number, data: unknown) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

async function answer(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = String(input).split('?')[0]
  const key = `${init?.method ?? 'GET'} ${path}`
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
  server.calls.push({ key, body })
  server.pending += 1
  try {
    if (key in server.gates) await server.gates[key]
    const refused = server.refuse[key]
    if (refused) {
      delete server.refuse[key]
      return json(refused.status, { detail: { code: refused.code, message: refused.code } })
    }
    if (!(key in server.answers)) return json(404, { detail: { code: 'not_found', message: 'Not found.' } })
    const found = server.answers[key]
    const data = typeof found === 'function' ? (found as (body: unknown) => unknown)(body) : found
    return data === undefined ? json(204, null) : json(200, data)
  } finally {
    server.pending -= 1
  }
}

let root: Root | null = null
let host: HTMLElement | null = null

const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1))
  })

/** Lets the page work until no answer is on its way; fails after two seconds instead of returning half done. */
async function settle(): Promise<void> {
  const until = Date.now() + 2_000
  let quiet = 0
  while (quiet < 2) {
    if (Date.now() >= until) throw new Error(`settle: ${server.pending} answer(s) still on their way after 2 s`)
    await tick()
    quiet = server.pending === 0 ? quiet + 1 : 0
  }
}

async function mount(ui: ReactNode, path = '/', route = '*'): Promise<HTMLElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={ui} />
        </Routes>
      </MemoryRouter>,
    )
  })
  await settle()
  return host
}

async function unmount(): Promise<void> {
  await act(async () => root?.unmount())
  host?.remove()
  root = null
  host = null
}

async function click(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error('nothing to click')
  await act(async () => {
    ;(element as HTMLElement).click()
  })
}

async function choose(element: Element | null | undefined, value: string): Promise<void> {
  if (!element) throw new Error('nothing to choose in')
  const field = element as HTMLSelectElement
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(field, value)
    field.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function type(element: Element | null | undefined, value: string): Promise<void> {
  if (!element) throw new Error('nothing to type into')
  const field = element as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function button(container: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)
}

// --- The scene --------------------------------------------------------------------------------------------------------

const robin = { id: 1, name: 'robin', display_name: 'Robin Keller', role: 'operator', suite: '', sign_in: 'password', email: '', avatar: null, whats_new_seen: '' }

/** Three accounts: robin (its person in nexsuite has no display name), jona (left out last time, blocked), and mila
 * (nexsuite brought it before a disconnect, and its person is gone there since). */
function connecting() {
  server.answers['GET /api/suite'] = { state: 'connecting', url: 'https://suite.example.com', last_sync: null, problem: '', emergency_codes: 0, mail: false }
  server.answers['GET /api/suite/proposal'] = {
    people: [
      { id: '1', name: 'robin', display_name: '', email: 'robin@example.com' },
      { id: '6', name: 'jona', display_name: 'Jona Berg', email: 'jona.new@example.com' },
    ],
    accounts: [
      { id: 1, name: 'robin', display_name: 'Robin Keller', email: 'robin@example.com', role: 'operator', suggest: '1', blocked: false, from_suite: false, gone: false },
      { id: 4, name: 'jona', display_name: 'Jona', email: 'jona@example.com', role: 'member', suggest: 'skip', blocked: true, from_suite: false, gone: false },
      { id: 7, name: 'mila', display_name: 'Mila', email: '', role: 'member', suggest: 'skip', blocked: true, from_suite: true, gone: true },
    ],
    spaces: [{ id: 1, name: 'Ideen', color: '#ff8a70', suggest: '10' }],
    candidates: [{ id: '10', name: 'Ideen' }],
    teams: [],
    team_candidates: [],
  }
  server.answers['PUT /api/suite/choices'] = undefined
  server.answers['POST /api/suite/finish'] = { new_people: [] }
}

function proposal(): Record<string, unknown> {
  return server.answers['GET /api/suite/proposal'] as Record<string, unknown>
}

const row = (page: HTMLElement, name: string) => page.querySelector<HTMLElement>(`[data-testid="suite-row-${name}"]`)!

beforeEach(async () => {
  server.answers = {
    'GET /api/auth/me': { ...robin },
    'GET /api/auth/methods': { password: true, providers: [] },
    'GET /api/backups': [],
  }
  server.calls = []
  server.refuse = {}
  server.gates = {}
  server.pending = 0
  vi.stubGlobal('fetch', vi.fn(answer))
  auth.me = { ...robin }
  auth.status = 'signedIn'
  await i18n.changeLanguage('en')
})
afterEach(async () => {
  await unmount()
  vi.unstubAllGlobals()
})

describe('the assistant (B8, B16, B9, B23, B25, G9)', () => {
  it('marks blocked rows, those nexsuite brought and those whose person is gone, and names what changes', async () => {
    connecting()
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Continue connecting'))
    await settle()
    const badges = (name: string) => [...row(page, name).querySelectorAll('[data-testid="suite-badge"]')].map((badge) => badge.textContent)
    expect(badges('jona')).toEqual(['blocked'])
    expect(badges('robin')).toEqual([])
    expect(row(page, 'jona').querySelector('select')!.value).toBe('skip')
    expect(row(page, 'jona').textContent).not.toContain('Taken over')
    expect(badges('mila')).toEqual(['blocked', 'came from nexsuite'])
    expect(row(page, 'mila').textContent).toContain('Its person was deleted in nexsuite.')
    // Robin's person has no display name there: connecting gives it the one from here (B16), so nothing changes.
    expect(row(page, 'robin').textContent).not.toContain('Display name becomes')
    await choose(row(page, 'jona').querySelector('select'), '6')
    expect(row(page, 'jona').textContent).toContain('Blocked. Taken over, the account can sign in again.')
    expect(row(page, 'jona').textContent).toContain('Display name becomes “Jona Berg”')
    expect(row(page, 'jona').textContent).toContain('Address becomes jona.new@example.com')
  })

  it('keeps the choices and the step, and comes back to them (B23)', async () => {
    connecting()
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Continue connecting'))
    await settle()
    await choose(row(page, 'mila').querySelector('select'), 'new')
    await click(button(page, 'Next'))
    await settle()
    const kept = calls('PUT /api/suite/choices').at(-1)!.body as { accounts: Record<string, string>; step: number }
    expect(kept.step).toBe(3)
    expect(kept.accounts['7']).toBe('new')
    // Closed and opened again: the server hands back what was kept.
    await unmount()
    server.answers['GET /api/suite/proposal'] = { ...proposal(), chosen: { accounts: { '1': '1', '4': 'skip', '7': 'new' }, spaces: { '1': 'keep' }, teams: {}, step: 3 } }
    const again = await mount(<SuiteCard />)
    await click(button(again, 'Continue connecting'))
    await settle()
    expect(again.querySelector<HTMLSelectElement>('li select')!.value).toBe('keep')
    await click(button(again, 'Back'))
    expect(row(again, 'mila').querySelector('select')!.value).toBe('new')
  })

  it('never brings back a kept "leave out" for the own account (B23)', async () => {
    connecting()
    server.answers['GET /api/suite/proposal'] = { ...proposal(), chosen: { accounts: { '1': 'skip', '4': '6', '7': 'new' }, spaces: {}, teams: {}, step: 2 } }
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Continue connecting'))
    await settle()
    // The own account always needs a person: its suggestion stands, the others come back as kept.
    expect(row(page, 'robin').querySelector('select')!.value).toBe('1')
    expect(row(page, 'jona').querySelector('select')!.value).toBe('6')
    expect(row(page, 'mila').querySelector('select')!.value).toBe('new')
  })

  it('says what stays in nexsuite on giving up, only once something was made there', async () => {
    connecting()
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Continue connecting'))
    await settle()
    expect(page.querySelector('[data-testid="suite-made"]')).toBeNull()
    await click(button(page, 'Next'))
    await settle()
    // The last step fails half way: ben is a person in nexsuite now.
    server.refuse['POST /api/suite/finish'] = { status: 502, code: 'suite_unreachable' }
    server.answers['GET /api/suite/proposal'] = { ...proposal(), made: 1 }
    await click(button(page, 'Connect'))
    await settle()
    await click(button(page, 'Back'))
    expect(page.querySelector('[data-testid="suite-made"]')!.textContent).toBe(
      'What is created in nexsuite already (people, teams, spaces) stays there if you cancel. New people with an address have been sent the mail to set their password. Connecting again suggests them once more.',
    )
  })

  it('locks the choices once the connection went out to nexsuite, and says so', async () => {
    connecting()
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Continue connecting'))
    await settle()
    expect(page.querySelector('[data-testid="suite-sent"]')).toBeNull()
    expect(row(page, 'jona').querySelector('select')!.disabled).toBe(false)
    await click(button(page, 'Next'))
    await settle()
    // The answer to the last step got lost: nexsuite may have the connection.
    server.refuse['POST /api/suite/finish'] = { status: 502, code: 'suite_unreachable' }
    server.answers['GET /api/suite/proposal'] = { ...proposal(), made: 1, sent: true }
    await click(button(page, 'Connect'))
    await settle()
    const sentence = 'The connection has been sent to nexsuite already. The choices from then apply; for other choices, cancel and connect again.'
    expect(page.querySelector('[data-testid="suite-sent"]')!.textContent).toBe(sentence)
    expect([...page.querySelectorAll('li select')].every((select) => (select as HTMLSelectElement).disabled)).toBe(true)
    await click(button(page, 'Back'))
    expect(page.querySelector('[data-testid="suite-sent"]')!.textContent).toBe(sentence)
    expect(row(page, 'jona').querySelector('select')!.disabled).toBe(true)
  })

  it('shows after a reload exactly the choices that went out, locked, though nexsuite offers no space any more', async () => {
    connecting()
    server.answers['GET /api/suite/proposal'] = {
      ...proposal(),
      candidates: [{ id: '10', name: 'Ideen' }],
      spaces: [{ id: 1, name: 'Ideen', color: '#ff8a70', suggest: 'keep' }],
      sent: true,
      made: 1,
      chosen: { accounts: { '1': '1', '4': '6', '7': 'new' }, spaces: { '1': '10' }, teams: {}, step: 3 },
    }
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Continue connecting'))
    await settle()
    const space = page.querySelector<HTMLSelectElement>('li select')!
    expect(space.value).toBe('10')
    expect(space.selectedOptions[0].textContent).toContain('Ideen')
    expect(space.disabled).toBe(true)
    expect(page.querySelector('[data-testid="suite-sent"]')).not.toBeNull()
    await click(button(page, 'Back'))
    expect(row(page, 'jona').querySelector('select')!.value).toBe('6')
    expect(row(page, 'mila').querySelector('select')!.value).toBe('new')
    expect(row(page, 'jona').querySelector('select')!.disabled).toBe(true)
    expect(calls('PUT /api/suite/choices')).toHaveLength(0)
  })

  it('says after giving up when nexsuite may still list nexcanvas, and only then', async () => {
    connecting()
    server.answers['POST /api/suite/abort'] = { kept_in_suite: true }
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Continue connecting'))
    await settle()
    await click(button(page, 'Cancel and forget'))
    await settle()
    expect(page.querySelector('[data-testid="suite-kept"]')!.textContent).toBe(
      'nexsuite could not be reached. nexcanvas may still be listed there under Apps; disconnect it there before you connect again.',
    )
    await unmount()
    server.answers['POST /api/suite/abort'] = undefined
    const again = await mount(<SuiteCard />)
    await click(button(again, 'Continue connecting'))
    await settle()
    await click(button(again, 'Cancel and forget'))
    await settle()
    expect(again.querySelector('[data-testid="suite-kept"]')).toBeNull()
  })

  it('says what takes a moment and connects once for two clicks (B25)', async () => {
    connecting()
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Continue connecting'))
    await settle()
    await click(button(page, 'Next'))
    await settle()
    const release = hold('POST /api/suite/finish')
    const connect = button(page, 'Connect')!
    // Two clicks before the page could show the first as busy.
    await act(async () => {
      connect.click()
      connect.click()
    })
    expect(page.querySelector('[data-testid="suite-busy"]')!.textContent).toContain('nexcanvas connects to nexsuite')
    release()
    await settle()
    expect(calls('POST /api/suite/finish')).toHaveLength(1)
  })

  it('says that nexsuite is being asked while pairing (B25)', async () => {
    server.answers['GET /api/suite'] = { state: '', url: '', last_sync: null, problem: '', emergency_codes: 0, mail: false }
    connecting()
    server.answers['GET /api/suite'] = { state: '', url: '', last_sync: null, problem: '', emergency_codes: 0, mail: false }
    server.answers['POST /api/suite/start'] = () => proposal()
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Connect to nexsuite'))
    const fields = page.querySelectorAll<HTMLInputElement>('input')
    await type(fields[0], 'https://suite.example.com')
    await type(page.querySelector('input[placeholder="ABCD-EFGH-JKLM"]'), 'GOOD-CODE-1234')
    const release = hold('POST /api/suite/start')
    await click(button(page, 'Next'))
    expect(page.querySelector('[data-testid="suite-busy"]')!.textContent).toContain('One moment, nexsuite is being asked.')
    release()
    await settle()
  })

  it('loads the lists anew when nexsuite lost a person that was chosen (B9)', async () => {
    connecting()
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Continue connecting'))
    await settle()
    await choose(row(page, 'jona').querySelector('select'), '6')
    await click(button(page, 'Next'))
    await settle()
    server.refuse['POST /api/suite/finish'] = { status: 409, code: 'person_unknown' }
    const before = calls('GET /api/suite/proposal').length
    // The person is gone from nexsuite meanwhile.
    server.answers['GET /api/suite/proposal'] = { ...proposal(), people: [{ id: '1', name: 'robin', display_name: '', email: 'robin@example.com' }] }
    await click(button(page, 'Connect'))
    await settle()
    expect(calls('GET /api/suite/proposal').length).toBe(before + 1)
    expect(page.textContent).toContain('A person you chose is not in nexsuite (any more).')
    expect(row(page, 'jona').querySelector('select')!.value).toBe('skip')
  })

  it('puts each choice under its name on a phone, never over it (G9)', async () => {
    connecting()
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Continue connecting'))
    await settle()
    const select = row(page, 'jona').querySelector('select')!
    // Full width below 640 px (its own line under the name), as wide as it needs from sm on; the arrow only there.
    expect(select.className).toContain('w-full')
    expect(select.className).toContain('sm:w-auto')
    expect(select.className).not.toMatch(/(^|\s)max-w-56/)
    const arrow = row(page, 'jona').querySelector('[aria-hidden="true"]:not(svg)')
    expect(arrow?.className).toContain('hidden')
    expect(arrow?.className).toContain('sm:inline')
  })
})

describe('the pairing code (B24)', () => {
  it('takes no more than a code can be', async () => {
    server.answers['GET /api/suite'] = { state: '', url: '', last_sync: null, problem: '', emergency_codes: 0, mail: false }
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Connect to nexsuite'))
    const field = page.querySelector<HTMLInputElement>('input[placeholder="ABCD-EFGH-JKLM"]')!
    expect(field.maxLength).toBe(40)
  })

  it.each([
    ['not_suite', 'No nexsuite answers at this address.'],
    ['app_still_connected', 'An app at this address is still connected to nexsuite.'],
    ['app_not_reachable', 'nexsuite knows a connection with this address and cannot reach the app to ask.'],
  ])('says what %s means', async (code, text) => {
    server.answers['GET /api/suite'] = { state: '', url: '', last_sync: null, problem: '', emergency_codes: 0, mail: false }
    server.refuse['POST /api/suite/start'] = { status: 409, code }
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Connect to nexsuite'))
    await type(page.querySelectorAll<HTMLInputElement>('input')[0], 'https://other.example.com/x')
    await type(page.querySelector('input[placeholder="ABCD-EFGH-JKLM"]'), 'GOOD-CODE-1234')
    await click(button(page, 'Next'))
    await settle()
    expect(page.textContent).toContain(text)
  })
})

describe('disconnecting (B17)', () => {
  const connected = { state: 'connected', url: 'https://suite.example.com', last_sync: null, problem: '', emergency_codes: 2, mail: false }

  it('names who stops being an operator, and says so afterwards', async () => {
    auth.me = { ...robin, suite: 'connected', suite_emergency: true }
    server.answers['GET /api/suite'] = { ...connected, operators_from_suite: ['Anna Berg'], roles_kept: true, operators_staying: [] }
    server.answers['POST /api/suite/disconnect'] = { without_password: [], blocked: [], operators_back: ['Anna Berg'] }
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Disconnect'))
    expect(page.querySelector('[data-testid="leave-operators"]')!.textContent).toBe('Operators through nexsuite only, members again afterwards: Anna Berg.')
    expect(page.querySelector('[data-testid="leave-operators-unknown"]')).toBeNull()
    await type(document.querySelector('input[type="password"]'), 'the password')
    const dialog = document.querySelector('[role="dialog"]')!
    await click([...dialog.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Disconnect').at(-1))
    await settle()
    expect(page.querySelector('[data-testid="operators-back"]')!.textContent).toBe('Members again, they were operators through nexsuite only: Anna Berg.')
  })

  it('says for a connection from before that the operators stay', async () => {
    auth.me = { ...robin, suite: 'connected', suite_emergency: true }
    server.answers['GET /api/suite'] = { ...connected, operators_from_suite: [], roles_kept: false, operators_staying: ['Anna Berg'] }
    const page = await mount(<SuiteCard />)
    await click(button(page, 'Disconnect'))
    expect(page.querySelector('[data-testid="leave-operators-unknown"]')!.textContent).toBe(
      'For this connection it is not known who was an operator before; these operators stay operators: Anna Berg.',
    )
  })

  it('says to make the emergency codes before they are needed (G3)', async () => {
    auth.me = { ...robin, suite: 'connected', suite_emergency: true }
    server.answers['GET /api/suite'] = { ...connected, emergency_codes: 0 }
    const page = await mount(<SuiteCard />)
    expect(page.textContent).toContain('none yet. Create them now in nexsuite under Apps and keep them: with nexsuite out of reach, they can no longer be created.')
  })
})

describe('signing in and old links (B11, B12, B26)', () => {
  it('names a new password in nexsuite among the reasons a session ended', async () => {
    auth.status = 'signedOut'
    server.answers['GET /api/auth/methods'] = { password: false, providers: [{ slug: 'oidc', label: 'nexsuite' }], suite: true, suite_url: 'https://suite.example.com' }
    const page = await mount(<LoginPage />, '/login?ended=1')
    expect(page.textContent).toContain('or your password was changed in nexsuite')
  })

  it('keeps the plain reason on its own', async () => {
    auth.status = 'signedOut'
    const page = await mount(<LoginPage />, '/login?ended=1')
    expect(page.textContent).toContain('blocked or signed out everywhere. Sign in again.')
    expect(page.textContent).not.toContain('nexsuite')
  })

  it('says that nexsuite may still be signed in and offers someone else through it (B11)', async () => {
    auth.status = 'signedOut'
    server.answers['GET /api/auth/methods'] = { password: false, providers: [{ slug: 'oidc', label: 'nexsuite' }], suite: true, suite_url: 'https://suite.example.com' }
    const page = await mount(<LoginPage />, '/login?next=%2Fb%2F5')
    const box = page.querySelector('[data-testid="still-signed-in"]')!
    expect(box.textContent).toContain('If you are still signed in to nexsuite, the button takes you in as the same person without asking.')
    const other = [...box.querySelectorAll('a')].find((a) => a.textContent === 'Sign in as someone else')!
    expect(other.href).toBe('https://suite.example.com/')
    expect(other.target).toBe('_blank')
    expect(box.textContent).toContain('Sign out there, then use “Sign in with nexsuite” here.')
    // The button keeps the page asked for (B10).
    const signIn = [...page.querySelectorAll('a')].find((a) => a.textContent === 'Sign in with nexsuite')!
    expect(signIn.getAttribute('href')).toBe('/api/oidc/oidc/start?next=%2Fb%2F5')
  })

  it('says at once that an invitation from before connecting holds no more', async () => {
    server.refuse['GET /api/invite/abc'] = { status: 404, code: 'invite_suite' }
    const page = await mount(<InvitePage />, '/invite/abc', '/invite/:token')
    expect(page.textContent).toContain('nexcanvas is connected to nexsuite now')
  })

  it('tells a person nexsuite made a moment ago to try again (B20)', async () => {
    auth.status = 'signedOut'
    server.answers['GET /api/auth/methods'] = { password: false, providers: [{ slug: 'oidc', label: 'nexsuite' }], suite: true, suite_url: 'https://suite.example.com' }
    const page = await mount(<LoginPage />, '/login?error=suite_no_account')
    expect(page.textContent).toContain('nexcanvas does not know you yet. Try again in a few seconds')
  })
})

describe('where things live while connected (G3, G8, B15)', () => {
  it('gives the way to nexsuite for profile, password and second factor', async () => {
    auth.me = { ...robin, role: 'member', suite: 'connected', sign_in: 'oidc', suite_url: 'https://suite.example.com' }
    const profile = await mount(<AccountPage />, '/account')
    expect(profile.querySelector<HTMLAnchorElement>('[data-testid="suite-link"]')!.href).toBe('https://suite.example.com/')
    await unmount()
    const security = await mount(<AccountPage />, '/account?tab=security')
    expect(security.textContent).toContain('You change your password and second factor in nexsuite')
    expect(security.querySelector('[data-testid="suite-link"]')).not.toBeNull()
  })

  it('names no way to nexsuite on its own', async () => {
    const page = await mount(<AccountPage />, '/account?tab=security')
    expect(page.querySelector('[data-testid="suite-link"]')).toBeNull()
  })

  it('shows the mail server from nexsuite in words, never a raw value or a dash', async () => {
    const settings = { smtp_host: 'smtp.example.com', smtp_port: 25, smtp_security: 'none', smtp_user: '', smtp_from: 'boards@example.com' }
    const card = { settings, save: async () => undefined, busy: false, problem: null, done: null } as never
    const page = await mount(<MailCard server={card} readOnly />)
    await act(async () => {
      await i18n.changeLanguage('de')
    })
    await settle()
    const shown = page.querySelector('[data-testid="mail-from-suite"]')!.textContent!
    expect(shown).toContain('keine')
    expect(shown).not.toContain('none')
    expect(shown).toContain('nicht gesetzt')
    expect(shown).not.toMatch(/[–—]/)
    // Host and port in the one row its label names, as in nexbrand and nextasks.
    expect(shown).toContain('Server und Portsmtp.example.com:25')
  })

  it('says when nexsuite has no mail server, once', async () => {
    const settings = { smtp_host: '', smtp_port: 587, smtp_security: 'starttls', smtp_user: '', smtp_from: '' }
    const card = { settings, save: async () => undefined, busy: false, problem: null, done: null } as never
    const page = await mount(<MailCard server={card} readOnly />)
    expect(page.querySelector('[data-testid="mail-from-suite"]')).toBeNull()
    expect(page.textContent).toContain('No mail server is set up in nexsuite, so nexcanvas sends no mail. Your own setting is kept in case you disconnect.')
    expect(page.textContent!.split('sends no mail')).toHaveLength(2)
    expect(page.textContent!.split('Your own setting is kept')).toHaveLength(2)
  })

  const settings = { backup_schedule: 'daily', backup_keep: 7 }
  const backupsServer = { settings, save: async () => undefined, busy: false, problem: null, done: null } as never

  it('says why restoring is missing while connected, and to an operator from nexsuite why the rest is too (B15)', async () => {
    auth.me = { ...robin, suite: 'connected', sign_in: 'oidc', suite_emergency: false }
    const operator = await mount(<BackupsCard server={backupsServer} />)
    expect(operator.textContent).toContain(
      'While connected, only the emergency account downloads or deletes backups: an archive contains its password and second factor. Restoring works once nexcanvas is disconnected from nexsuite.',
    )
    await unmount()
    auth.me = { ...robin, suite: 'connected', suite_emergency: true }
    const keeper = await mount(<BackupsCard server={backupsServer} />)
    expect(keeper.textContent).toContain('Restoring works once nexcanvas is disconnected from nexsuite.')
    expect(keeper.textContent).not.toContain('only the emergency account')
    await unmount()
    auth.me = { ...robin }
    const alone = await mount(<BackupsCard server={backupsServer} />)
    expect(alone.textContent).not.toContain('nexsuite')
  })
})
