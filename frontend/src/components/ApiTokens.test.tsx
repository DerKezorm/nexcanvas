// The hint on the API tokens of an account that came in through a provider which checked the second factor, though the
// account has none of its own: a token has no session to be sheltered by, so it works only once the account sets one
// up. Making a token stays possible; the hint says so above the list and at each token, with the way to the setup.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

import i18n from '../i18n'
import { ApiTokens } from './ApiTokens'

vi.mock('../state/auth', () => ({ useAuth: () => ({ me: { id: 1, name: 'anna', role: 'member', sign_in: 'password', two_factor: false } }) }))
vi.mock('../board/store', async (original) => ({
  ...(await original<typeof import('../board/store')>()),
  useBoards: () => ({ spaces: [], boards: [], loaded: true }),
}))

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const token = { id: 1, name: 'n8n', level: 'read', prefix: 'nxc_ab', created_at: '2026-10-01T10:00:00Z', last_used_at: null, expires_at: null, blocked: false, spaces: null }
let answer: { allowed: boolean; tokens: unknown[]; second_factor_pending?: boolean }
let root: Root
let host: HTMLElement

beforeEach(async () => {
  answer = { allowed: true, tokens: [token] }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } })))
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

async function show(): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ApiTokens />
      </MemoryRouter>,
    )
  })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

describe('the hint on a token that waits for a second factor', () => {
  it.each(['en', 'de'] as const)('stands above the list and at the token in %s, with the way to the setup', async (language) => {
    await i18n.changeLanguage(language)
    answer = { ...answer, second_factor_pending: true }
    await show()
    const hint = host.querySelector('[data-testid="api-tokens-waits"]')!
    expect(hint.textContent).toContain(i18n.t('apiTokens.waitsForSecondFactor'))
    expect(hint.querySelector('a')!.getAttribute('href')).toBe('/account?tab=security')
    expect(host.querySelector('[data-testid="api-token-waits"]')!.textContent).toBe(i18n.t('apiTokens.waitsForSecondFactor'))
    expect(i18n.t('apiTokens.waitsForSecondFactor')).toBe(language === 'en' ? 'Works only once you set up a second factor.' : 'Wirkt erst, wenn du einen zweiten Faktor einrichtest.')
    // Making a token stays possible.
    expect([...host.querySelectorAll('button')].some((button) => button.textContent?.includes(i18n.t('apiTokens.new')))).toBe(true)
  })

  it('is not there where the token works', async () => {
    await show()
    expect(host.querySelector('[data-testid="api-tokens-waits"]')).toBeNull()
    expect(host.querySelector('[data-testid="api-token-waits"]')).toBeNull()
  })

  it('does not mark a token the operator blocked', async () => {
    answer = { allowed: true, tokens: [{ ...token, blocked: true }], second_factor_pending: true }
    await show()
    expect(host.querySelector('[data-testid="api-token-waits"]')).toBeNull()
  })
})
