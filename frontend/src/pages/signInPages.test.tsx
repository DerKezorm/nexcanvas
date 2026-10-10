/**
 * The pages a person meets around sign-in providers, as the shared sign-in blueprint lays them out (part 04): the
 * sign-in page with a button per provider below "or" (only the buttons and the operator's way when the password is
 * off), the code step after a provider that is not trusted with the second factor, an error from the address only as a
 * fixed sentence, the invitation's "Continue with …", the account page's row per provider, and the address a provider
 * offers.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import i18n from '../i18n'

type Answer = { status: number; body: unknown }
type Handler = (method: string, path: string, body: unknown) => Answer | undefined

let handler: Handler = () => undefined
const calls: { method: string; path: string; body: unknown }[] = []

const scene = vi.hoisted(() => ({
  me: null as Record<string, unknown> | null,
  status: 'signedOut' as string,
  assigned: [] as string[],
}))
const assigned = scene.assigned

vi.mock('../lib/providers', async (original) => ({
  ...(await original<typeof import('../lib/providers')>()),
  go: (url: string) => void scene.assigned.push(url),
}))

vi.mock('../state/auth', async (original) => ({
  ...(await original<typeof import('../state/auth')>()),
  useAuth: () => ({ me: scene.me, status: scene.status, setMe: () => undefined, refresh: async () => undefined, signOut: async () => undefined }),
}))

let root: Root
let box: HTMLDivElement

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0
  assigned.length = 0
  handler = () => undefined
  scene.me = null
  scene.status = 'signedOut'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ method, path, body })
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
  for (let i = 0; i < 8; i++) await act(async () => await Promise.resolve())
}

async function render(node: React.ReactNode, at = '/'): Promise<void> {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[at]}>{node}</MemoryRouter>)
  })
  await settle()
}

const providers = [
  { slug: 'authentik', label: 'authentik' },
  { slug: 'entra', label: 'Microsoft' },
]
const buttons = () => [...box.querySelectorAll('button')].map((button) => button.textContent)
const click = async (text: string) => {
  const found = [...box.querySelectorAll('button')].find((button) => button.textContent === text)
  expect(found, text).toBeDefined()
  await act(async () => found!.click())
  await settle()
}

describe('the sign-in page', () => {
  it('has the password form, the line "or" and a button per provider in the order of the list', async () => {
    const { LoginPage } = await import('./AuthPages')
    handler = (_m, path) => (path === '/api/auth/methods' ? { status: 200, body: { password: true, providers } } : undefined)
    await render(<LoginPage />, '/login?next=%2Fb%2F5')
    expect(box.querySelector('input[type="password"]')).not.toBeNull()
    expect([...box.querySelectorAll('div')].some((node) => node.textContent === i18n.t('oidc.login.or'))).toBe(true)
    expect(buttons().filter((text) => text?.startsWith('Sign in with'))).toEqual(['Sign in with authentik', 'Sign in with Microsoft'])
    await click('Sign in with Microsoft')
    expect(assigned).toEqual(['/api/oidc/entra/start?next=%2Fb%2F5'])
  })

  it("with the password off shows only the buttons, and small the operator's way with the password", async () => {
    const { LoginPage } = await import('./AuthPages')
    handler = (_m, path) => (path === '/api/auth/methods' ? { status: 200, body: { password: false, providers } } : undefined)
    await render(<LoginPage />, '/login')
    expect(box.querySelector('input[type="password"]')).toBeNull()
    expect([...box.querySelectorAll('div')].some((node) => node.textContent === i18n.t('oidc.login.or'))).toBe(false)
    await click(i18n.t('oidc.login.operator'))
    expect(box.querySelector('input[type="password"]')).not.toBeNull()
    expect(buttons()).toContain('Sign in with authentik')
  })

  it('says an error from the address in the fixed words, an unknown one never as it stands', async () => {
    const { LoginPage } = await import('./AuthPages')
    handler = (_m, path) => (path === '/api/auth/methods' ? { status: 200, body: { password: true, providers } } : undefined)
    await render(<LoginPage />, '/login?error=oidc_no_account')
    expect(box.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('oidc.error.oidc_no_account'))
    act(() => root.unmount())
    root = createRoot(box)
    await render(<LoginPage />, '/login?error=%3Cb%3Ewhatever_code')
    const alert = box.querySelector('[role="alert"]')?.textContent ?? ''
    expect(alert).not.toContain('whatever_code')
    expect(alert).toBe(i18n.t('errors.internal_error'))
  })

  it('asks for the code after a provider that does not check the second factor (?step=code)', async () => {
    const { LoginPage } = await import('./AuthPages')
    handler = (_m, path) => (path === '/api/auth/methods' ? { status: 200, body: { password: true, providers } } : undefined)
    await render(<LoginPage />, '/login?step=code')
    expect(box.textContent).toContain(i18n.t('auth.code.title'))
    expect(box.querySelector('input[autocomplete="one-time-code"]')).not.toBeNull()
  })
})

describe('the invitation page', () => {
  it('offers "Continue with …" per provider below "or", taking the invitation along', async () => {
    const { InvitePage } = await import('./AuthPages')
    handler = (_m, path) => {
      if (path.startsWith('/api/invite/')) return { status: 200, body: { space: null, role: null, by: 'Robin', min_password: 12, signed_in_as: null } }
      if (path === '/api/auth/methods') return { status: 200, body: { password: true, providers } }
      return undefined
    }
    await render(
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
      </Routes>,
      '/invite/abc',
    )
    expect([...box.querySelectorAll('div')].some((node) => node.textContent === i18n.t('oidc.login.or'))).toBe(true)
    expect(buttons().filter((text) => text?.startsWith('Continue with'))).toEqual(['Continue with authentik', 'Continue with Microsoft'])
    await click('Continue with authentik')
    expect(assigned).toEqual(['/api/oidc/authentik/start?invite=abc'])
  })
})

describe('the account page', () => {
  const me = { id: 2, name: 'alex', display_name: '', avatar: null, role: 'member', sign_in: 'password', email: '', provider_email: '', two_factor: false, suite: '' }

  async function account(at: string, mine: Record<string, unknown>[], change: Record<string, unknown> = {}) {
    const { AccountPage } = await import('./AccountPage')
    scene.me = { ...me, ...change }
    scene.status = 'signedIn'
    handler = (method, path) => {
      if (path === '/api/oidc/me') return { status: 200, body: mine }
      if (path === '/api/oidc/entra/link' && method === 'POST') return { status: 200, body: { url: 'https://login.example.com/authorize' } }
      if (path === '/api/oidc/me/address') return { status: 200, body: { email: 'alex@example.com' } }
      if (path === '/api/auth/me') return { status: 200, body: { ...me, ...change } }
      return undefined
    }
    await render(<AccountPage />, at)
  }

  it('has a row per provider with its state; "Link" asks for the password first', async () => {
    await account('/account?tab=security', [
      { slug: 'authentik', label: 'authentik', linked: true, managed: 'authentik' },
      { slug: 'entra', label: 'Microsoft', linked: false, managed: '' },
    ])
    const rows = [...box.querySelectorAll('[data-testid="my-providers"] li')]
    expect(rows.map((row) => row.textContent)).toEqual([
      `authentik${i18n.t('oidc.account.linked')}${i18n.t('oidc.account.unlink')}`,
      `Microsoft${i18n.t('oidc.account.notLinked')}${i18n.t('oidc.account.link')}`,
    ])
    await click(i18n.t('oidc.account.link'))
    const field = rows[1].querySelector<HTMLInputElement>('input[type="password"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'secret words')
    act(() => void field.dispatchEvent(new Event('input', { bubbles: true })))
    await act(async () => rows[1].querySelector('form')!.requestSubmit())
    await settle()
    expect(calls.find((call) => call.path === '/api/oidc/entra/link')?.body).toEqual({ password: 'secret words' })
    expect(assigned).toEqual(['https://login.example.com/authorize'])
  })

  it('back from linking names the provider by its button, not its short name', async () => {
    await account('/account?linked=entra', [{ slug: 'entra', label: 'Microsoft', linked: true, managed: '' }])
    expect(box.textContent).toContain(i18n.t('me.linked', { name: 'Microsoft' }))
  })

  it('keeps the last link of an account without a password, and says so', async () => {
    await account('/account?tab=security', [{ slug: 'entra', label: 'Microsoft', linked: true, managed: '' }], { sign_in: 'oidc' })
    expect(buttons()).not.toContain(i18n.t('oidc.account.unlink'))
    expect(box.textContent).toContain(i18n.t('oidc.account.only', { name: 'Microsoft' }))
  })

  it('offers the address a provider knows; taking it asks the server', async () => {
    await account('/account', [], { provider_email: 'alex@example.com' })
    expect(box.querySelector('[data-testid="mail-offer"]')?.textContent).toContain('alex@example.com')
    await click(i18n.t('me.emailTake'))
    expect(calls.some((call) => call.method === 'POST' && call.path === '/api/oidc/me/address')).toBe(true)
  })
})
