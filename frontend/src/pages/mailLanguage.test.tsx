// Mails go out in the language of whoever receives them (decision 8 of 05.10.2026). When neither the receiver nor the
// sender has a language of their own, the server takes the language the sender's page shows; the page sends it along
// with the invitation and with the test mail.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import i18n from '../i18n'
import { MembersDialog } from '../components/MembersDialog'
import { AccountsCard, MailCard, useServerSettings } from './settings/ServerCards'

vi.mock('../state/auth', () => ({ useAuth: () => ({ me: { id: 1, name: 'operator', role: 'operator', mail: true } }) }))
vi.mock('../board/store', () => ({ useBoards: () => ({ refresh: async () => undefined, spaces: [] }) }))

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const SETTINGS = { smtp_host: 'smtp.example.com', smtp_port: 587, smtp_security: 'starttls', smtp_user: '', smtp_password_set: false, smtp_from: 'boards@example.com' }

let bodies: Record<string, Record<string, unknown>> = {}
let root: Root
let box: HTMLDivElement

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  bodies = {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (init?.method === 'POST') bodies[path] = JSON.parse(String(init.body))
      if (path === '/api/settings') return json(SETTINGS)
      if (path === '/api/accounts' || path === '/api/invites') return init?.method === 'POST' ? json({ link: 'https://boards.example.com/invite/x', sent: true, email: 'zoe@example.com' }, 201) : json([])
      if (path === '/api/settings/mail-test') return new Response(null, { status: 204 })
      if (path === '/api/directory') return json({ people: [], teams: [] })
      if (path === '/api/spaces/4/members') return json({ space: 'Ideen', members: [], invites: [], asked: [], role: 'manage' })
      if (path === '/api/spaces/4/invites') return json({ id: 1, link: 'https://boards.example.com/invite/y', sent: true, email: 'zoe@example.com' }, 201)
      return new Response('{}', { status: 404 })
    }),
  )
  await i18n.changeLanguage('de')
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

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

function type(input: Element | null | undefined, value: string) {
  const field = input as HTMLInputElement
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
  act(() => {
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function press(text: string) {
  const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === text)
  expect(button, text).toBeTruthy()
  await act(async () => button!.click())
  await settle()
}

function Mail() {
  const server = useServerSettings()
  return <MailCard server={server} />
}

describe('the page language goes along', () => {
  it('with the test mail', async () => {
    await act(async () => root.render(<Mail />))
    await settle()
    type(box.querySelector('input[placeholder="you@example.com"]'), 'zoe@example.com')
    await press(i18n.t('server.send'))
    expect(bodies['/api/settings/mail-test']).toEqual({ to: 'zoe@example.com', language: 'de' })
  })

  it('with an invitation into nexcanvas', async () => {
    await act(async () => root.render(<AccountsCard />))
    await settle()
    type(box.querySelector('input[type="email"]'), 'zoe@example.com')
    await press(i18n.t('invite.create'))
    expect(bodies['/api/invites']).toMatchObject({ email: 'zoe@example.com', send: true, language: 'de' })
  })

  it('with an invitation into a space', async () => {
    const space = { id: 4, name: 'Ideen', color: '', role: 'manage' as const, boards: 0, members: [], teams: [] }
    await act(async () => root.render(<MembersDialog space={space} onClose={() => undefined} />))
    await settle()
    type(document.querySelector('input[type="email"]'), 'zoe@example.com')
    await press(i18n.t('invite.create'))
    expect(bodies['/api/spaces/4/invites']).toMatchObject({ email: 'zoe@example.com', send: true, language: 'de' })
  })
})
