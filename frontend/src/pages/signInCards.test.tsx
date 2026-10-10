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
/** With ``count`` the setup answer carries the number of an issuer change; ``afterConfirm`` is what the run answers once it is sent with ``confirm_issuer_change``. */
let count: number | undefined
let afterConfirm: Step[] | null = null
let list: OidcProvider[] = []
let settings = { password_login: true, two_factor_required: false, public_url: 'https://boards.example.com' }
/** What `GET /api/oidc/authentik/address` says; the browser of the test is at http://localhost:3000. */
const ADDRESS = {
  public_url: 'https://boards.example.com',
  seen: 'https://boards.example.com',
  forwarded_proto: '',
  forwarded_host: '',
  proxy_ignored: false,
  callback_path: '/api/oidc/authentik/callback',
  redirect_uri: 'https://boards.example.com/api/oidc/authentik/callback',
  registered_redirect_uri: '',
  stale: false,
}
let addressView: Record<string, unknown> = ADDRESS
/** When set, saving the address (settings or the card's second button) is answered with this refusal until it comes with the confirmation. */
let refusal: { status: number; detail: Record<string, unknown> } | null = null
let gate: Promise<void> = Promise.resolve()
let calls: { method: string; path: string; body: unknown }[] = []
let root: Root
let box: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  answer = []
  count = undefined
  afterConfirm = null
  list = []
  settings = { password_login: true, two_factor_required: false, public_url: 'https://boards.example.com' }
  addressView = ADDRESS
  refusal = null
  gate = Promise.resolve()
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (path === '/api/settings' && method === 'PUT') {
        const sent = JSON.parse(String(init?.body ?? '{}')) as { public_url?: string; confirm_address?: boolean }
        if (refusal && !sent.confirm_address) return json({ detail: refusal.detail }, refusal.status)
        if (sent.public_url !== undefined) settings = { ...settings, public_url: sent.public_url }
        return json(settings)
      }
      if (path === '/api/settings') return json(settings)
      if (path === '/api/oidc/authentik/address' && method === 'GET') return json(addressView)
      if (path === '/api/oidc/authentik/address' && method === 'POST') {
        const sent = JSON.parse(String(init?.body ?? '{}')) as { public_url: string; confirm?: boolean }
        if (refusal && !sent.confirm) return json({ detail: refusal.detail }, refusal.status)
        addressView = { ...ADDRESS, public_url: sent.public_url, redirect_uri: sent.public_url + ADDRESS.callback_path }
        return json(addressView)
      }
      if (path === '/api/oidc/admin/providers' && method === 'GET') return json(list)
      if (path.endsWith('/impact')) return json({ issuer_change: 0, count: 3, only: 1, only_names: ['kim'] })
      if (path === '/api/oidc/authentik/setup') {
        await gate
        const confirmed = (JSON.parse(String(init?.body ?? '{}')) as { confirm_issuer_change?: boolean }).confirm_issuer_change === true
        const steps = confirmed && afterConfirm ? afterConfirm : answer
        return json({ ok: steps.every((step) => step.ok) && steps.length === STEP_KEYS.length, steps, client_id: '', issuer: '', provider_id: null, links_dropped: 0, ...(!confirmed && count !== undefined ? { count } : {}) })
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

  describe('the question before an issuer change (module 1.0.8)', () => {
    const stopped: Step[] = [
      { key: STEP_KEYS[0], ok: false, detail: 'another issuer', reason: 'issuer_change', status: 0 },
    ]
    const dialog = () => document.querySelector('[role="dialog"]')

    it.each(['en', 'de'] as const)('asks in %s with the number of accounts and sends nothing more until it is answered yes', async (language) => {
      answer = stopped
      count = 7
      await card(language)
      await press(authentikCard(), i18n.t('oidc.authentik.run'))
      await settle()
      expect(dialog()!.textContent).toContain(i18n.t('oidc.admin.issuerChangeConfirm', { count: 7 }))
      // The step list says it too, with the number in it (no placeholder left over).
      expect(rows()).toEqual([`✗${i18n.t('oidc.authentik.step.reached')}${i18n.t('oidc.authentik.why.issuer_change', { count: 7 })}`])
      expect(box.textContent).not.toContain('{{')
      expect(calls.filter((call) => call.path === '/api/oidc/authentik/setup').map((call) => call.body)).toEqual([
        { url: 'https://auth.example.com', token: 'token', confirm_issuer_change: false, public_url: '' },
      ])
    })

    it('runs the button once more with the confirmation on yes, and shows what that run did', async () => {
      answer = stopped
      afterConfirm = STEP_KEYS.map((key) => ({ key, ok: true, detail: key }))
      count = 2
      await card('en')
      await press(authentikCard(), i18n.t('oidc.authentik.run'))
      await settle()
      await press(dialog()!, i18n.t('oidc.authentik.run'))
      await settle()
      const bodies = calls.filter((call) => call.path === '/api/oidc/authentik/setup').map((call) => call.body)
      expect(bodies).toEqual([
        { url: 'https://auth.example.com', token: 'token', confirm_issuer_change: false, public_url: '' },
        { url: 'https://auth.example.com', token: 'token', confirm_issuer_change: true, public_url: '' },
      ])
      expect(dialog()).toBeNull()
      expect(rows()).toEqual(STEP_KEYS.map((key) => `✓${i18n.t(`oidc.authentik.step.${key}`)}`))
      expect(tokenField().value).toBe('')
    })

    it('changes nothing on no: no second call, the token stays for the next try', async () => {
      answer = stopped
      count = 2
      await card('en')
      await press(authentikCard(), i18n.t('oidc.authentik.run'))
      await settle()
      await press(dialog()!, i18n.t('common.cancel'))
      await settle()
      expect(dialog()).toBeNull()
      expect(calls.filter((call) => call.path === '/api/oidc/authentik/setup')).toHaveLength(1)
      expect(tokenField().value).toBe('token')
    })

    it('does not ask for any other failure', async () => {
      answer = [{ key: STEP_KEYS[0], ok: false, detail: 'down', reason: 'unreachable', status: 0 }]
      await card('en')
      await press(authentikCard(), i18n.t('oidc.authentik.run'))
      await settle()
      expect(dialog()).toBeNull()
    })
  })

  describe('the public address in the card (module 1.0.10)', () => {
    const NONE = { ...ADDRESS, public_url: '', seen: 'http://localhost:3000', redirect_uri: 'http://localhost:3000/api/oidc/authentik/callback' }
    const dialog = () => document.querySelector('[role="dialog"]')
    const setups = () => calls.filter((call) => call.path === '/api/oidc/authentik/setup').map((call) => call.body)
    const saves = () => calls.filter((call) => call.path === '/api/oidc/authentik/address' && call.method === 'POST').map((call) => call.body)

    it('shows the ordinary button with an address, and no suggestion', async () => {
      await page()
      expect(box.querySelector('[data-testid="authentik-no-address"]')).toBeNull()
      expect(box.querySelector('[data-testid="authentik-stale"]')).toBeNull()
      expect(button(authentikCard(), i18n.t('oidc.authentik.run'))).toBeDefined()
      expect(button(authentikCard(), i18n.t('oidc.authentik.adoptOnly'))).toBeUndefined()
      expect(authentikCard().querySelector('a[href="/api/oidc/authentik/blueprint"]')).not.toBeNull()
    })

    it.each(['en', 'de'] as const)('suggests the address of the browser in %s, with where authentik leads back to, and sends it with the button', async (language) => {
      addressView = NONE
      answer = STEP_KEYS.map((key) => ({ key, ok: true, detail: key }))
      await card(language)
      const warning = box.querySelector('[data-testid="authentik-no-address"]')!
      expect(warning.textContent).toContain(i18n.t('oidc.authentik.noAddress'))
      expect(warning.querySelector('[data-testid="authentik-proposal"]')!.textContent).toBe('http://localhost:3000')
      expect(warning.textContent).toContain('http://localhost:3000/api/oidc/authentik/callback')
      expect(box.textContent).not.toContain('{{')
      // The blueprint has nothing to name yet: no link.
      expect(authentikCard().querySelector('a[href="/api/oidc/authentik/blueprint"]')).toBeNull()
      await press(authentikCard(), i18n.t('oidc.authentik.adopt'))
      await settle()
      expect(setups()).toEqual([{ url: 'https://auth.example.com', token: 'token', confirm_issuer_change: false, public_url: 'http://localhost:3000' }])
    })

    it('warns when the server sees another scheme than the browser uses, and not when they agree', async () => {
      addressView = { ...NONE, seen: 'http://localhost:3000' }
      await page()
      expect(box.querySelector('[data-testid="authentik-proxy-warning"]')).toBeNull()
      act(() => root.unmount())
      root = createRoot(box)
      addressView = { ...NONE, seen: 'https://localhost:3000' }
      await page()
      expect(box.querySelector('[data-testid="authentik-proxy-warning"]')!.textContent).toContain('https://localhost:3000')
      act(() => root.unmount())
      root = createRoot(box)
      addressView = { ...NONE, proxy_ignored: true }
      await page()
      expect(box.querySelector('[data-testid="authentik-proxy-warning"]')).not.toBeNull()
    })

    it('says that authentik still knows the old address, with the old one in it', async () => {
      addressView = { ...ADDRESS, stale: true, registered_redirect_uri: 'https://old.example.com/api/oidc/authentik/callback' }
      await page()
      expect(box.querySelector('[data-testid="authentik-stale"]')!.textContent).toBe(
        i18n.t('oidc.authentik.stale', { address: 'https://old.example.com/api/oidc/authentik/callback' }),
      )
    })

    it('saves only the address with the second button, asks first when that changes what authentik knows, and says yes with the confirmation', async () => {
      addressView = NONE
      refusal = { status: 409, detail: { code: 'public_url_change', message: 'x', count: 1, hand: 2, address: 'https://old.example.com/cb' } }
      await page()
      await press(authentikCard(), i18n.t('oidc.authentik.adoptOnly'))
      await settle()
      const asked = dialog()!.textContent!
      expect(asked).toContain(i18n.t('oidc.admin.addressChangeConfirm', { address: 'https://old.example.com/cb' }))
      expect(asked).toContain(i18n.t('oidc.admin.addressChangeHand', { count: 2 }))
      expect(saves()).toEqual([{ public_url: 'http://localhost:3000', confirm: false }])
      await press(dialog()!, i18n.t('oidc.authentik.adoptOnly'))
      await settle()
      expect(saves()).toEqual([
        { public_url: 'http://localhost:3000', confirm: false },
        { public_url: 'http://localhost:3000', confirm: true },
      ])
      expect(dialog()).toBeNull()
      expect(box.querySelector('[data-testid="authentik-no-address"]')).toBeNull()
    })

    it('asks about the entries by hand alone, without the sentence about authentik', async () => {
      addressView = NONE
      refusal = { status: 409, detail: { code: 'public_url_change', message: 'x', count: 0, hand: 1, address: '' } }
      await page()
      await press(authentikCard(), i18n.t('oidc.authentik.adoptOnly'))
      await settle()
      expect(dialog()!.textContent).toContain(i18n.t('oidc.admin.addressChangeHand', { count: 1 }))
      expect(dialog()!.textContent).not.toContain('authentik still knows')
    })

    it('says an address that is none cannot be used', async () => {
      addressView = NONE
      refusal = { status: 422, detail: { code: 'public_url_invalid', message: 'x' } }
      await page()
      await press(authentikCard(), i18n.t('oidc.authentik.adoptOnly'))
      await settle()
      expect(authentikCard().querySelector('[data-testid="authentik-unusable"]')!.textContent).toBe(i18n.t('oidc.authentik.why.unusable'))
      expect(dialog()).toBeNull()
    })

    it('asks in card 1 as well before the address is saved, and sends the confirmation on yes', async () => {
      refusal = { status: 409, detail: { code: 'public_url_change', message: 'x', count: 1, hand: 0, address: 'https://boards.example.com/cb' } }
      await page()
      const card1 = document.getElementById('sign-in')!
      type(card1.querySelector(`input[placeholder="https://boards.example.com"]`), 'https://new.example.com')
      await act(async () => card1.querySelector('form')!.requestSubmit())
      await settle()
      expect(dialog()!.textContent).toContain(i18n.t('oidc.admin.addressChangeConfirm', { address: 'https://boards.example.com/cb' }))
      const puts = () => calls.filter((call) => call.method === 'PUT' && call.path === '/api/settings').map((call) => call.body)
      expect(puts()).toEqual([{ public_url: 'https://new.example.com', confirm_address: false }])
      await press(dialog()!, i18n.t('common.save'))
      await settle()
      expect(puts()).toEqual([
        { public_url: 'https://new.example.com', confirm_address: false },
        { public_url: 'https://new.example.com', confirm_address: true },
      ])
      expect(dialog()).toBeNull()
    })
  })
})
