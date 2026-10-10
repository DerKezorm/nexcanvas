/**
 * Prüfgang 05.10.2026 for nexcanvas on its own: the hint about a proxy nobody named (A5), the switch for team leads
 * (D3), an open page that asks after its session every five seconds (A8), and the sentences for the new refusals.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

import i18n from '../i18n'
import { errorText } from '../lib/errors'

type Answer = { status: number; body: unknown }
type Handler = (method: string, path: string, body: unknown) => Answer | undefined

let handler: Handler = () => undefined
const calls: { method: string; path: string; body: unknown }[] = []

const me = { value: { id: 1, name: 'robin', display_name: 'Robin', avatar: null, role: 'operator', suite: '', may_edit_led_teams: true } as Record<string, unknown> }

vi.mock('../state/auth', async (original) => {
  const real = await original<typeof import('../state/auth')>()
  return { ...real, useAuth: () => (mockedAuth ? { me: me.value, setMe: () => undefined, signOut: async () => undefined } : real.useAuth()) }
})
let mockedAuth = true

let root: Root
let box: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0
  mockedAuth = true
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, path, body })
      const answer = handler(method, path, body) ?? { status: 404, body: { detail: { code: 'not_found' } } }
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } })
    }),
  )
  box = document.createElement('div')
  document.body.append(box)
  root = createRoot(box)
})

afterEach(() => {
  act(() => root.unmount())
  box.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function render(node: React.ReactNode, at = '/'): Promise<void> {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[at]}>{node}</MemoryRouter>)
  })
  await settle()
}

describe('the proxy hint (A5)', () => {
  it('names the setting while a proxy stands in front unnamed', async () => {
    const { ProxyHint } = await import('./settings/ServerCards')
    handler = (_m, path) => (path === '/api/settings' ? { status: 200, body: { proxy_unknown: true } } : undefined)
    await render(<ProxyHint />)
    const hint = box.querySelector('[data-testid="proxy-hint"]')
    expect(hint?.getAttribute('role')).toBe('status')
    expect(hint?.textContent).toBe(i18n.t('server.proxyUnknown'))
    expect(hint?.textContent).toContain('NEXCANVAS_TRUSTED_PROXIES')
  })

  it('stays away otherwise', async () => {
    const { ProxyHint } = await import('./settings/ServerCards')
    handler = (_m, path) => (path === '/api/settings' ? { status: 200, body: { proxy_unknown: false } } : undefined)
    await render(<ProxyHint />)
    expect(box.querySelector('[data-testid="proxy-hint"]')).toBeNull()
  })
})

describe('team leads (D3)', () => {
  const directory = {
    me: 2,
    people: [
      { id: 1, name: 'robin', display_name: 'Robin', avatar: null },
      { id: 2, name: 'anna', display_name: 'Anna', avatar: null },
    ],
    teams: [{ id: 7, name: 'Netz', color: '#60a5fa', lead: 2, source: 'local', members: [2], size: 1 }],
  }

  it('offers the lead no change while the operator has not allowed it', async () => {
    const { TeamsCard } = await import('../components/Teams')
    me.value = { ...me.value, id: 2, role: 'member', may_edit_led_teams: false }
    handler = (_m, path) => (path === '/api/directory' ? { status: 200, body: directory } : undefined)
    await render(<TeamsCard />)
    expect(box.textContent).toContain('Netz')
    expect([...box.querySelectorAll('button')].map((b) => b.textContent)).not.toContain(i18n.t('teams.edit'))
    me.value = { ...me.value, may_edit_led_teams: true }
    await render(<TeamsCard />)
    expect([...box.querySelectorAll('button')].map((b) => b.textContent)).toContain(i18n.t('teams.edit'))
  })

  it('gives the operator the switch, off from the start, and saves it', async () => {
    const { TeamsCard } = await import('../components/Teams')
    me.value = { ...me.value, id: 1, role: 'operator', may_edit_led_teams: true }
    handler = (method, path, body) => {
      if (path === '/api/directory') return { status: 200, body: { ...directory, me: 1 } }
      if (path === '/api/settings' && method === 'GET') return { status: 200, body: { team_leads_edit: false } }
      if (path === '/api/settings' && method === 'PUT') return { status: 200, body: { team_leads_edit: (body as { team_leads_edit: boolean }).team_leads_edit } }
      if (path === '/api/auth/me') return { status: 200, body: me.value }
      return undefined
    }
    await render(<TeamsCard />)
    expect(box.textContent).toContain(i18n.t('teams.leadsSwitch'))
    expect(box.textContent).toContain(i18n.t('teams.leadsSwitchHint'))
    const toggle = box.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(toggle.checked).toBe(false)
    await act(async () => toggle.click())
    await settle()
    expect(calls.filter((c) => c.method === 'PUT' && c.path === '/api/settings').map((c) => c.body)).toEqual([{ team_leads_edit: true }])
    expect(box.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true)
  })

  it('puts the switch back when the server refuses it', async () => {
    const { TeamsCard } = await import('../components/Teams')
    me.value = { ...me.value, id: 1, role: 'operator', may_edit_led_teams: true }
    handler = (method, path) => {
      if (path === '/api/directory') return { status: 200, body: { ...directory, me: 1 } }
      if (path === '/api/settings' && method === 'GET') return { status: 200, body: { team_leads_edit: false } }
      if (path === '/api/settings' && method === 'PUT') return { status: 409, body: { detail: { code: 'managed_by_suite' } } }
      return undefined
    }
    await render(<TeamsCard />)
    await act(async () => box.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await settle()
    expect(box.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
    expect(box.textContent).toContain(errorText('managed_by_suite'))
  })

  it('names a team only in the hint in every space, as in nextasks', () => {
    expect(i18n.getFixedT('de')('teams.leadsSwitchHint')).toContain('in allen Bereichen')
    expect(i18n.getFixedT('en')('teams.leadsSwitchHint')).toContain('in every space')
  })
})

describe('an open page asks after its session (A8)', () => {
  function Where() {
    const location = useLocation()
    return <span data-testid="where">{location.pathname + location.search}</span>
  }

  it('is on the sign-in within five seconds of its session ending, and the sign-in says why', async () => {
    mockedAuth = false
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { AuthProvider, SESSION_MS } = await import('../state/auth')
    const { default: App } = await import('../App')
    expect(SESSION_MS).toBe(5_000)
    let session = true
    handler = (_m, path) => {
      if (path === '/api/setup') return { status: 200, body: { needs_setup: false, signed_in: session } }
      if (path === '/api/auth/me')
        return session ? { status: 200, body: { ...me.value, id: 1, preferences: { start: 'boards' } } } : { status: 401, body: { detail: { code: 'sign_in_required' } } }
      if (path === '/api/auth/methods') return { status: 200, body: { password: true, providers: [], suite: false } }
      // The page behind the sign-in only has to stand; what it shows does not matter here.
      if (path.startsWith('/api/about')) return { status: 500, body: { detail: { code: 'internal_error' } } }
      if (path.startsWith('/api/')) return { status: 200, body: [] }
      return undefined
    }
    await render(
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Where />} />
          <Route path="/about" element={<Where />} />
        </Routes>
        <App />
      </AuthProvider>,
      '/about',
    )
    const asked = () => calls.filter((c) => c.path === '/api/auth/me').length
    const before = asked()
    expect(before).toBeGreaterThan(0)
    // Blocked or signed out everywhere elsewhere: nothing here knows yet.
    session = false
    await act(async () => {
      vi.advanceTimersByTime(4_999)
    })
    await settle()
    expect(asked()).toBe(before)
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    await settle()
    expect(asked()).toBe(before + 1)
    expect(box.querySelector('[data-testid="where"]')?.textContent).toBe('/login?ended=1&next=%2Fabout')
    // Loading the whole app the first time takes seconds on a slow machine; the clock of the test stands still.
  }, 30_000)

  let visible = 'visible'
  function shown(state: 'visible' | 'hidden'): void {
    visible = state
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible })
  }

  async function provider(at: string, signedIn: boolean): Promise<{ asked: () => number }> {
    mockedAuth = false
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { AuthProvider, useAuth } = await import('../state/auth')
    function State() {
      const auth = useAuth()
      return (
        <>
          <span data-testid="state">{`${auth.status} ended=${auth.ended}`}</span>
          <button type="button" onClick={() => void auth.signOut()}>
            out
          </button>
        </>
      )
    }
    handler = (_m, path) => {
      if (path === '/api/setup') return { status: 200, body: { needs_setup: false, signed_in: signedIn } }
      if (path === '/api/auth/me') return { status: 200, body: { ...me.value, id: 1 } }
      if (path === '/api/auth/logout') return { status: 204, body: null }
      return undefined
    }
    await render(
      <AuthProvider>
        <Routes>
          <Route path="*" element={<State />} />
        </Routes>
      </AuthProvider>,
      at,
    )
    return { asked: () => calls.filter((c) => c.path === '/api/auth/me').length }
  }

  async function wait(ms: number): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(ms)
    })
    await settle()
  }

  afterEach(() => shown('visible'))

  it('asks nothing while signed out', async () => {
    const { asked } = await provider('/login', false)
    await wait(30_000)
    expect(asked()).toBe(0)
  })

  it('asks nothing in a hidden tab, and once at once when it shows again', async () => {
    const { asked } = await provider('/about', true)
    const before = asked()
    shown('hidden')
    await wait(30_000)
    expect(asked()).toBe(before)
    shown('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await settle()
    expect(asked()).toBe(before + 1)
  })

  it('asks nothing on a public page, signed in or not', async () => {
    const { asked } = await provider('/s/abcdefgh', true)
    const before = asked()
    await wait(30_000)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await settle()
    expect(asked()).toBe(before)
  })

  it('says nothing ended after signing out here, also when a request ends meanwhile', async () => {
    const { SIGNED_OUT_EVENT } = await import('../api/client')
    await provider('/about', true)
    const state = () => box.querySelector('[data-testid="state"]')?.textContent
    expect(state()).toBe('signedIn ended=false')
    // Ended elsewhere: said.
    await act(async () => {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
    })
    expect(state()).toBe('signedOut ended=true')
    // Signing out here puts it away, and a request that finds the session gone while signing out does not say it.
    const inner = handler
    handler = (method, path, body) => {
      if (path === '/api/auth/logout') window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
      return inner(method, path, body)
    }
    await act(async () => box.querySelector('button')!.click())
    await settle()
    expect(state()).toBe('signedOut ended=false')
  })
})

describe('the sentences for the new refusals', () => {
  it.each([
    ['account_blocked', 'Dieses Konto ist gesperrt. Wende dich an den Betreiber.', 'This account is blocked. Ask the operator.'],
    ['password_unchanged', 'Das neue Passwort ist dasselbe wie das bisherige. Nimm ein anderes.', 'The new password is the same as the current one. Choose another.'],
    ['invalid_characters', 'Der Text enthält Steuerzeichen, die man nicht sieht. Tipp ihn neu ein, statt ihn einzufügen.', 'The text contains control characters you cannot see. Type it anew instead of pasting it.'],
    ['team_leads_off', 'Der Betreiber hat Teamleitungen nicht erlaubt, ihre Teams zu ändern.', 'The operator has not let team leads change their teams.'],
    ['too_many_pixels', 'Das Bild hat mehr Pixel, als nexcanvas annimmt (höchstens 50 Millionen).', 'This picture has more pixels than nexcanvas accepts (50 million at most).'],
  ])('%s', async (code, german, english) => {
    const language = i18n.language
    try {
      await i18n.changeLanguage('de')
      expect(errorText(code, { max_million: 50 })).toBe(german)
      await i18n.changeLanguage('en')
      expect(errorText(code, { max_million: 50 })).toBe(english)
    } finally {
      await i18n.changeLanguage(language)
    }
  })
})
