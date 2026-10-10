// Settings, Server, Sign-in as the shared sign-in blueprint lays it out (part 04): three cards, the provider form with
// its fields in their order, the confirmations with their numbers, the authentik steps by name with the reason of a
// failure in words (Prüfgang C4), and what a coupling to nexsuite locks (part 06). The step keys come from the shared
// module's own list (`STEP_KEYS` in backend/app/vendor/nexoidc/authentik.py), so a name the language files spell
// differently shows up here instead of on the operator's screen.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { OidcProvider } from '../api/client'
import i18n from '../i18n'
import { useServerSettings } from './settings/ServerCards'
import { SignInPart } from './settings/SignInCards'

vi.mock('../state/auth', () => ({ useAuth: () => ({ me: { id: 1, name: 'operator', role: 'operator', sign_in: 'password', two_factor: true } }) }))

type Files = { readFileSync: (file: string, encoding: string) => string }
const fsName = 'node:fs'
const files = (await import(/* @vite-ignore */ fsName)) as Files

const service = files.readFileSync('../backend/app/vendor/nexoidc/authentik.py', 'utf-8')
const STEP_KEYS = [...(service.match(/^STEP_KEYS = \(([^)]*)\)/m)?.[1] ?? '').matchAll(/"(\w+)"/g)].map((found) => found[1])
type Step = { key: string; ok: boolean; detail: string; reason?: string; status?: number }

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

function entry(change: Partial<OidcProvider> = {}): OidcProvider {
  return {
    id: 1,
    slug: 'sso',
    label: 'Company SSO',
    issuer: 'https://sso.example.com',
    client_id: 'client',
    has_secret: true,
    scopes: 'openid profile email',
    enabled: true,
    auto_create: false,
    trusts_second_factor: true,
    managed: '',
    position: 0,
    redirect_uri: 'https://boards.example.com/api/oidc/sso/callback',
    links: 2,
    editable: true,
    ...change,
  }
}

/** What the server answers next, and a gate that holds the setup answer back while a test looks at the page. */
let answer: Step[] = []
let list: OidcProvider[] = []
let settings = { password_login: true, two_factor_required: false, public_url: 'https://boards.example.com' }
let gate: Promise<void> = Promise.resolve()
let calls: { method: string; path: string; body: unknown }[] = []
let root: Root
let box: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  answer = []
  list = []
  settings = { password_login: true, two_factor_required: false, public_url: 'https://boards.example.com' }
  gate = Promise.resolve()
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (path === '/api/settings') return json(settings)
      if (path === '/api/oidc/admin/providers' && method === 'GET') return json(list)
      if (path.endsWith('/impact')) return json({ issuer_change: 0, count: 3, only: 1, only_names: ['kim'] })
      if (path === '/api/oidc/authentik/setup') {
        await gate
        return json({ ok: answer.every((step) => step.ok) && answer.length === STEP_KEYS.length, steps: answer, client_id: '', issuer: '', provider_id: null, links_dropped: 0 })
      }
      return new Response('{}', { status: 404 })
    }),
  )
  box = document.createElement('div')
  document.body.append(box)
  root = createRoot(box)
})

afterEach(async () => {
  act(() => root.unmount())
  box.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  await i18n.changeLanguage('en')
})

function SignIn({ connected = false }: { connected?: boolean }) {
  const server = useServerSettings()
  return <SignInPart server={server} connected={connected} />
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

function type(input: Element | null | undefined, value: string) {
  const field = input as HTMLInputElement
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
  act(() => {
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const authentikCard = () => document.getElementById('sign-in-authentik')!
const tokenField = () => [...authentikCard().querySelectorAll<HTMLInputElement>('input[type="password"]')].at(-1)!
const rows = () => [...document.querySelectorAll('[data-testid="authentik-steps"] li')].map((row) => row.textContent)
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll('button')].find((found) => found.textContent === text)

async function press(scope: ParentNode, text: string) {
  const found = button(scope, text)
  expect(found, text).toBeDefined()
  await act(async () => found!.click())
}

async function page(language: 'en' | 'de' = 'en', connected = false) {
  await act(async () => {
    await i18n.changeLanguage(language)
    root.render(<SignIn connected={connected} />)
  })
  await settle()
}

/** The card in `language`, with address and token typed in; the button not yet pressed. */
async function card(language: 'en' | 'de') {
  await page(language)
  type(authentikCard().querySelector('input[placeholder="https://auth.example.com"]'), 'https://auth.example.com')
  type(tokenField(), 'token')
}

describe('the three cards', () => {
  it('stand in the blueprint order with its titles, and the password switch stays on while no provider is active', async () => {
    list = [entry({ enabled: false })]
    await page()
    const titles = [...box.querySelectorAll('section h2')].map((title) => title.textContent)
    expect(titles).toEqual([i18n.t('oidc.admin.signInTitle'), i18n.t('oidc.admin.providersTitle'), i18n.t('oidc.authentik.title')])
    const password = box.querySelector<HTMLInputElement>(`input[aria-label="${i18n.t('oidc.admin.password')}"]`)!
    expect(password.checked).toBe(true)
    expect(password.disabled).toBe(true)
  })

  it('lets the password switch go once a provider is active', async () => {
    list = [entry()]
    await page()
    expect(box.querySelector<HTMLInputElement>(`input[aria-label="${i18n.t('oidc.admin.password')}"]`)!.disabled).toBe(false)
  })

  it('lists each entry with its issuer, marks, buttons and a handle to drag; empty, it says how to begin', async () => {
    await page()
    expect(box.textContent).toContain(i18n.t('oidc.admin.empty'))
    act(() => root.unmount())
    root = createRoot(box)
    list = [entry({ managed: 'authentik', label: 'authentik', slug: 'authentik' }), entry({ id: 2, slug: 'entra', label: 'Microsoft', enabled: false })]
    await page()
    const items = [...box.querySelectorAll('[data-testid="provider-list"] li')]
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('https://sso.example.com')
    expect(items[0].textContent).toContain(i18n.t('oidc.admin.active'))
    expect(items[0].textContent).toContain(i18n.t('oidc.admin.managed'))
    expect(items[1].textContent).toContain(i18n.t('oidc.admin.inactive'))
    expect(items[0].querySelector(`button[aria-label="${i18n.t('server.providers.order', { name: 'authentik' })}"] svg`)).not.toBeNull()
    expect(button(items[1], i18n.t('oidc.admin.edit'))).toBeDefined()
    expect(button(items[1], i18n.t('oidc.admin.remove'))).toBeDefined()
  })

  it('opens the form as a dialog with the fields in the blueprint order; the short name follows the name', async () => {
    await page()
    await press(box, i18n.t('oidc.admin.add'))
    const form = document.querySelector('[data-testid="provider-form"]')!
    const labels = [...form.querySelectorAll('span.text-xs.font-medium, input[type="checkbox"]')].map((node) =>
      node instanceof HTMLInputElement ? node.getAttribute('aria-label') : node.textContent,
    )
    expect(labels.filter((label) => label !== i18n.t('oidc.admin.scopes'))).toEqual([
      i18n.t('oidc.admin.label'),
      i18n.t('oidc.admin.slug'),
      i18n.t('oidc.admin.issuer'),
      i18n.t('oidc.admin.clientId'),
      i18n.t('oidc.admin.secret'),
      i18n.t('oidc.admin.redirect'),
      i18n.t('oidc.admin.enabled'),
      i18n.t('oidc.admin.autoCreate'),
      i18n.t('oidc.admin.trustsSecondFactor'),
    ])
    type(form.querySelector('input'), 'Größe Firma')
    const fields = [...form.querySelectorAll<HTMLInputElement>('input')]
    expect(fields[1].value).toBe('groesse-firma')
    expect(fields.find((field) => field.readOnly)!.value).toBe('https://boards.example.com/api/oidc/groesse-firma/callback')
    const switches = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((field) => field.checked)
    expect(switches).toEqual([true, false, true])
  })

  it('asks before removing an entry, with how many accounts lose the link and sign in only through it', async () => {
    list = [entry()]
    await page()
    await press(box, i18n.t('oidc.admin.remove'))
    await settle()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain(i18n.t('oidc.admin.removeConfirm', { name: 'Company SSO', count: 3, only: 1 }))
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  })
})

describe('coupled (blueprint 06)', () => {
  it('shows the list only, the set-aside entries off, the coupled one marked, and locks the authentik card', async () => {
    list = [
      entry({ id: 3, slug: 'oidc', label: 'nexsuite', managed: 'nexsuite', editable: false }),
      entry({ id: 1, slug: 'sso', enabled: false, editable: false }),
    ]
    await page('en', true)
    const items = [...box.querySelectorAll('[data-testid="provider-list"] li')]
    expect(items[0].textContent).toContain(i18n.t('server.providers.coupled'))
    expect(items[0].textContent).not.toContain('nexsuite' + i18n.t('oidc.admin.managed'))
    expect(items[1].textContent).toContain(i18n.t('oidc.admin.inactive'))
    expect(button(box, i18n.t('oidc.admin.add'))).toBeUndefined()
    expect(button(box, i18n.t('oidc.admin.edit'))).toBeUndefined()
    expect(box.querySelector('[draggable="true"]')).toBeNull()
    expect(authentikCard().textContent).toContain(i18n.t('oidc.authentik.why.coupled'))
    // Locked even with address and token typed in, and nothing goes to the server.
    type(authentikCard().querySelector('input[placeholder="https://auth.example.com"]'), 'https://auth.example.com')
    type(tokenField(), 'token')
    expect(button(authentikCard(), i18n.t('oidc.authentik.run'))!.disabled).toBe(true)
    await act(async () => authentikCard().querySelector('form')!.requestSubmit())
    expect(calls.some((call) => call.path === '/api/oidc/authentik/setup')).toBe(false)
    expect(authentikCard().querySelector('a[href="/api/oidc/authentik/blueprint"]')).toBeNull()
    expect(box.querySelector(`input[aria-label="${i18n.t('oidc.admin.password')}"]`)).toBeNull()
  })
})

describe('the authentik steps', () => {
  it('come from the module list', () => {
    expect(STEP_KEYS).toEqual(['reached', 'signingKey', 'mapping', 'provider', 'application', 'filled'])
  })

  it.each(['en', 'de'] as const)('are named in %s, and the token goes once all worked', async (language) => {
    answer = STEP_KEYS.map((key) => ({ key, ok: true, detail: `found ${key}` }))
    await card(language)
    await press(authentikCard(), i18n.t('oidc.authentik.run'))
    await settle()
    expect(rows()).toEqual(STEP_KEYS.map((key) => `✓${i18n.t(`oidc.authentik.step.${key}`)}`))
    expect(tokenField().value).toBe('')
  })

  it.each(['en', 'de'] as const)('say in %s why a step failed, by its name, and keep the token for the next try', async (language) => {
    const detail = 'POST /crypto/certificatekeypairs/generate/ answered 403 (application/json); the log has the answer'
    answer = [
      { key: STEP_KEYS[0], ok: true, detail: 'authentik 2026.8.1' },
      { key: STEP_KEYS[1], ok: false, detail, reason: 'token', status: 403 },
    ]
    await card(language)
    await press(authentikCard(), i18n.t('oidc.authentik.run'))
    await settle()
    const why = i18n.t('oidc.authentik.why.token', { status: 403 })
    expect(rows()).toEqual([`✓${i18n.t('oidc.authentik.step.reached')}`, `✗${i18n.t('oidc.authentik.step.signingKey')}${why}`])
    expect(box.textContent).not.toContain(detail)
    expect(tokenField().value).toBe('token')
  })

  it('says authentik is being asked while the run is under way, and the last answer goes first', async () => {
    answer = [{ key: STEP_KEYS[0], ok: false, detail: 'not reachable', reason: 'unreachable', status: 0 }]
    await card('en')
    await press(authentikCard(), i18n.t('oidc.authentik.run'))
    await settle()
    expect(rows()).toHaveLength(1)
    let release = () => undefined as void
    gate = new Promise((resolve) => {
      release = resolve
    })
    await press(authentikCard(), i18n.t('oidc.authentik.run'))
    expect(authentikCard().querySelector('[role="status"]')?.textContent).toBe(i18n.t('oidc.authentik.asking'))
    expect(rows()).toEqual([])
    release()
    await settle()
    expect(authentikCard().querySelector('[role="status"]')).toBeNull()
    expect(rows()).toEqual([`✗${i18n.t('oidc.authentik.step.reached')}${i18n.t('oidc.authentik.why.unreachable')}`])
  })

  it('warns without a public address, with a way to the field', async () => {
    settings = { ...settings, public_url: '' }
    await page()
    const warning = box.querySelector('[data-testid="authentik-no-address"]')!
    expect(warning.textContent).toContain(i18n.t('oidc.authentik.noAddress'))
    expect(warning.querySelector('a[href="#sign-in"]')).not.toBeNull()
  })
})
