// The steps after "Set up" under Settings, Server, Sign-in (the authentik button): each by its name, then what the server
// found; a failed one with its reason in words, as nexsuite says it (Prüfgang C4), and a line while authentik is asked.
// The keys come from the server's own list (`STEP_KEYS` in backend/app/services/authentik.py), so a name the language
// files spell differently ("fill" for "filled") shows up here instead of on the operator's screen.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import i18n from '../i18n'
import de from '../i18n/de.json'
import en from '../i18n/en.json'
import { SignInCard, useServerSettings } from './settings/ServerCards'

vi.mock('../state/auth', () => ({ useAuth: () => ({ me: { id: 1, name: 'operator', role: 'operator', sign_in: 'password', two_factor: true } }) }))

type Files = { readFileSync: (file: string, encoding: string) => string }
const fsName = 'node:fs'
const files = (await import(/* @vite-ignore */ fsName)) as Files

const service = files.readFileSync('../backend/app/services/authentik.py', 'utf-8')
const STEP_KEYS = [...(service.match(/^STEP_KEYS = \(([^)]*)\)/m)?.[1] ?? '').matchAll(/"(\w+)"/g)].map((found) => found[1])
const TEXTS = { de, en } as const
type Language = keyof typeof TEXTS
type Step = { key: string; ok: boolean; detail: string; reason?: string; status?: number }

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

/** What the setup call answers next, and a gate that holds the answer back while a test looks at the page. */
let answer: Step[] = []
let gate: Promise<void> = Promise.resolve()
let root: Root
let box: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  answer = []
  gate = Promise.resolve()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/settings') return json({ password_login: true, two_factor_required: false, public_url: '' })
      if (path === '/api/oidc/config')
        return json({ configured: false, issuer: '', client_id: '', provider_name: '', auto_create: false, redirect_uri: 'https://boards.example.com/api/oidc/callback' })
      if (path === '/api/oidc/authentik/setup') {
        await gate
        return json({ steps: answer, client_id: '', issuer: '' })
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
  vi.unstubAllGlobals()
  await i18n.changeLanguage('en')
})

function SignIn() {
  const server = useServerSettings()
  return <SignInCard server={server} />
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

function type(input: Element | null | undefined, value: string) {
  const field = input as HTMLInputElement
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
  act(() => {
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const tokenField = () => [...box.querySelectorAll<HTMLInputElement>('input[type="password"]')].at(-1)!
const rows = () => [...box.querySelectorAll('[data-testid="authentik-steps"] li')].map((row) => row.textContent)

async function press() {
  const run = [...box.querySelectorAll('button')].find((button) => button.textContent === i18n.t('server.authentik.run'))!
  await act(async () => run.click())
}

/** The card in `language`, with address and token typed in; the button not yet pressed. */
async function card(language: Language) {
  await act(async () => {
    await i18n.changeLanguage(language)
    root.render(<SignIn />)
  })
  await settle()
  type(box.querySelector('input[placeholder="https://auth.example.com"]'), 'https://auth.example.com')
  type(tokenField(), 'token')
}

describe('the authentik steps', () => {
  it('come from the server list', () => {
    expect(STEP_KEYS).toContain('reached')
    expect(STEP_KEYS).toContain('filled')
  })

  it.each(['en', 'de'] as const)('are named in %s, each before what the server found', async (language) => {
    answer = STEP_KEYS.map((key) => ({ key, ok: true, detail: `found ${key}` }))
    await card(language)
    await press()
    await settle()
    const names: Record<string, string> = TEXTS[language].authentik.step
    expect(rows()).toEqual(STEP_KEYS.map((key) => `✓ ${names[key]}: found ${key}`))
    // Everything worked: the token goes from the field, it is not needed again.
    expect(tokenField().value).toBe('')
  })

  it.each(['en', 'de'] as const)('say in %s why a step failed, by its name, and keep the token for the next try', async (language) => {
    const detail = 'POST /crypto/certificatekeypairs/generate/ answered 403 (application/json); the log has the answer'
    answer = [
      { key: STEP_KEYS[0], ok: true, detail: 'authentik 2026.8.1' },
      { key: STEP_KEYS[1], ok: false, detail, reason: 'token', status: 403 },
    ]
    await card(language)
    await press()
    await settle()
    const names: Record<string, string> = TEXTS[language].authentik.step
    const why = TEXTS[language].server.authentik.why.token.replace('{{status}}', '403')
    expect(rows()).toEqual([`✓ ${names[STEP_KEYS[0]]}: authentik 2026.8.1`, `✗ ${names[STEP_KEYS[1]]}: ${why}`])
    expect(box.textContent).not.toContain(detail)
    expect(tokenField().value).toBe('token')
  })

  it('says authentik is being asked while the run is under way, and the last answer goes first', async () => {
    answer = [{ key: STEP_KEYS[0], ok: false, detail: 'not reachable', reason: 'unreachable', status: 0 }]
    await card('en')
    await press()
    await settle()
    expect(rows()).toHaveLength(1)
    let release = () => undefined as void
    gate = new Promise((resolve) => {
      release = resolve
    })
    await press()
    expect(box.querySelector('[role="status"]')?.textContent).toBe(en.server.authentik.asking)
    expect(rows()).toEqual([])
    release()
    await settle()
    expect(box.querySelector('[role="status"]')).toBeNull()
    expect(rows()).toEqual([`✗ ${en.authentik.step.reached}: ${en.server.authentik.why.unreachable}`])
  })
})
