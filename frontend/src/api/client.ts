/**
 * The server's API. Every call names this browser tab in `X-Nexcanvas-Client` (changes without it are refused, the
 * wall against requests from other sites). Errors come back as `ApiError` with the server's code; the page builds
 * its sentence from `errors.<code>` in the language files.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly values: Record<string, unknown> = {},
  ) {
    super(code)
  }
}

const CLIENT_KEY = 'nexcanvas.client'
/** Sent on `window` when a request finds that the session is gone: the page goes back to the sign-in. */
export const SIGNED_OUT_EVENT = 'nexcanvas:signed-out'

function randomId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return 'tab-' + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

let clientId: string | null = null

/** One id per tab: sessionStorage survives a reload of the tab but is not shared with other tabs. */
export function tabId(): string {
  if (clientId) return clientId
  try {
    clientId = sessionStorage.getItem(CLIENT_KEY)
    if (!clientId) {
      clientId = randomId()
      sessionStorage.setItem(CLIENT_KEY, clientId)
    }
  } catch {
    clientId = randomId()
  }
  return clientId
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: Record<string, string | number | boolean | string[] | undefined>
  body?: unknown
  /** A file as the body (an upload), sent as it is. */
  raw?: Blob
  /** The answer is a file, not JSON. */
  blob?: boolean
}

const BUSY_TRIES = 3
const BUSY_WAIT_MS = 1500

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const repeatable = (options.method ?? 'GET') === 'GET'
  for (let attempt = 1; ; attempt++) {
    try {
      return await once<T>(path, options)
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'busy' && repeatable && attempt < BUSY_TRIES)) throw error
      await new Promise((resolve) => setTimeout(resolve, BUSY_WAIT_MS))
    }
  }
}

async function once<T>(path: string, options: Options): Promise<T> {
  const url = new URL(path, window.location.origin)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item)
    else if (value !== undefined) url.searchParams.set(key, String(value))
  }
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Nexcanvas-Client': tabId() }
  let body: BodyInit | undefined
  if (options.raw) body = options.raw
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  const response = await fetch(url.pathname + url.search, { method: options.method ?? 'GET', headers, body })
  if (response.status === 204) return undefined as T
  if (options.blob && response.ok) return (await response.blob()) as T
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = data?.detail
    if (detail && typeof detail === 'object' && typeof detail.code === 'string') {
      const { code, message: _message, ...values } = detail
      if (code === 'sign_in_required') window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
      throw new ApiError(response.status, code, values)
    }
    throw new ApiError(response.status, response.status === 401 ? 'sign_in_required' : 'internal_error')
  }
  return data as T
}

/** An upload with progress (fetch cannot report it): resolves with the server's answer. */
export function upload<T>(path: string, query: Record<string, string | number>, file: Blob, onProgress?: (part: number) => void): Promise<T> {
  const url = new URL(path, window.location.origin)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value))
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', url.pathname + url.search)
    request.setRequestHeader('X-Nexcanvas-Client', tabId())
    request.setRequestHeader('Accept', 'application/json')
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total)
    }
    request.onload = () => {
      let data: unknown = null
      try {
        data = JSON.parse(request.responseText)
      } catch {
        // no JSON
      }
      if (request.status >= 200 && request.status < 300) return resolve(data as T)
      const detail = (data as { detail?: { code?: string } } | null)?.detail
      reject(new ApiError(request.status, typeof detail?.code === 'string' ? detail.code : 'internal_error', (detail as Record<string, unknown>) ?? {}))
    }
    request.onerror = () => reject(new ApiError(0, 'network'))
    request.send(file)
  })
}

// ---- Types ----------------------------------------------------------------------------------------------------------

export type Role = 'read' | 'write' | 'manage'

export type Me = {
  id: number
  name: string
  display_name: string
  role: 'operator' | 'member'
  sign_in: 'password' | 'oidc'
  email: string
  language: string
  oidc_linked: boolean
  two_factor: boolean
  two_factor_recovery_left: number
  avatar: string | null
  version: string
  whats_new_seen: string
  shares_allowed?: boolean
  mail?: boolean
  second_factor_setup_required?: boolean
  upload_max_mb?: number
  preferences?: Preferences
}

export type Preferences = { snap: boolean; dots: boolean; tool_back: boolean; start: 'boards' | 'last' }

export type Member = { id: number; name: string; display_name: string; role: Role; avatar: string | null }

export type SpaceInfo = {
  id: number
  name: string
  color: string
  role: Role | null
  boards: number
  members: Member[]
}

export type BoardInfo = {
  id: string
  space_id: number
  title: string
  created_at: string
  updated_at: string
  updated_by: string
  deleted_at: string | null
  items: number
  favorite: boolean
  opened_at: string | null
  public: boolean
  role: Role | null
  picture?: { items: Record<string, unknown>[]; lines: Record<string, unknown>[] }
}

export type MediaInfo = {
  id: string
  name: string
  kind: string
  mime: string
  size: number
  width: number
  height: number
  pages: number
  removed: string[]
  known: boolean
}

export type SetupState = { needs_setup: boolean; code_required: boolean; signed_in: boolean; version: string; min_password: number }
export type Methods = { password: boolean; oidc: boolean; oidc_name: string }

// ---- Calls ----------------------------------------------------------------------------------------------------------

export const authApi = {
  setupState: () => api<SetupState>('/api/setup'),
  setup: (name: string, password: string, code: string, language: string) =>
    api<Me>('/api/setup', { method: 'POST', body: { name, password, code, language } }),
  methods: () => api<Methods>('/api/auth/methods'),
  login: (name: string, password: string) => api<Me | { second_factor: true }>('/api/auth/login', { method: 'POST', body: { name, password } }),
  code: (code: string) => api<Me>('/api/auth/login/totp', { method: 'POST', body: { code } }),
  cancelCode: () => api<void>('/api/auth/login/totp/cancel', { method: 'POST' }),
  logout: () => api<void>('/api/auth/logout', { method: 'POST' }),
  me: () => api<Me>('/api/auth/me'),
  language: (language: string) => api<Me>('/api/me/language', { method: 'PUT', body: { language } }),
  preferences: (change: Partial<Preferences>) => api<Preferences>('/api/me/preferences', { method: 'PUT', body: change }),
  profile: (display_name: string) => api<Me>('/api/me/profile', { method: 'PUT', body: { display_name } }),
  password: (current: string, next: string) => api<void>('/api/auth/password', { method: 'PUT', body: { current, new: next } }),
}

export const spacesApi = {
  list: () => api<SpaceInfo[]>('/api/spaces'),
  create: (name: string, color?: string) => api<SpaceInfo>('/api/spaces', { method: 'POST', body: { name, color } }),
  change: (id: number, change: { name?: string; color?: string }) => api<SpaceInfo>(`/api/spaces/${id}`, { method: 'PATCH', body: change }),
  trash: (id: number) => api<void>(`/api/spaces/${id}`, { method: 'DELETE' }),
  members: (id: number) =>
    api<{ space: string; members: { name: string; role: Role; you: boolean }[]; invites: Invite[]; role: Role | null }>(`/api/spaces/${id}/members`),
  setMember: (id: number, name: string, role: Role) =>
    api<{ name: string; role: Role; invited?: boolean }>(`/api/spaces/${id}/members/${encodeURIComponent(name)}`, { method: 'PUT', body: { role } }),
  removeMember: (id: number, name: string) => api<void>(`/api/spaces/${id}/members/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  invite: (id: number, role: Role, days = 7) => api<Invite & { link: string }>(`/api/spaces/${id}/invites`, { method: 'POST', body: { role, days } }),
}

export type Invite = { id: number; role: string; email: string; by: string | null; created_at: string; expires_at: string }

export const boardsApi = {
  list: (query: { space?: number; deleted?: boolean } = {}) => api<BoardInfo[]>('/api/boards', { query }),
  read: (id: string) => api<BoardInfo>(`/api/boards/${id}`),
  create: (space_id: number, title: string, content?: unknown) => api<BoardInfo>('/api/boards', { method: 'POST', body: { space_id, title, content } }),
  change: (id: string, change: { title?: string; space_id?: number }) => api<BoardInfo>(`/api/boards/${id}`, { method: 'PATCH', body: change }),
  copy: (id: string, title: string) => api<BoardInfo>(`/api/boards/${id}/copy`, { method: 'POST', body: { title } }),
  trash: (id: string) => api<void>(`/api/boards/${id}`, { method: 'DELETE' }),
  restore: (id: string) => api<BoardInfo>(`/api/boards/${id}/restore`, { method: 'POST' }),
  purge: (id: string) => api<void>(`/api/boards/${id}/purge`, { method: 'DELETE' }),
  favorite: (id: string, on: boolean) => api<{ favorite: boolean }>(`/api/boards/${id}/favorite`, { method: 'PUT', body: { on } }),
  visit: (id: string) => api<void>(`/api/boards/${id}/visit`, { method: 'POST' }),
  versions: (id: string) => api<{ id: number; created_at: string; authors: string; items: number }[]>(`/api/boards/${id}/versions`),
  restoreVersion: (id: string, version: number) => api<void>(`/api/boards/${id}/versions/${version}/restore`, { method: 'POST' }),
  /** Where the board downloads as JSON Canvas (a .canvas file, or a .zip when photos and files go along). */
  exportUrl: (id: string) => `/api/boards/${encodeURIComponent(id)}/export`,
  importCanvas: (id: string, file: Blob, at: { x: number; y: number }) =>
    upload<{ items: number; lines: number; files: number; missing: string[]; skipped: number }>(`/api/boards/${encodeURIComponent(id)}/import`, { x: Math.round(at.x), y: Math.round(at.y) }, file),
  search: (q: string) => api<BoardInfo[]>('/api/search', { query: { q } }),
}

export const mediaApi = {
  upload: (space: number, file: File | Blob, name: string, onProgress?: (part: number) => void) =>
    upload<MediaInfo>('/api/media', { space, name }, file, onProgress),
}

/** Where a photo or file of a board is shown from. Only ever built from an id, never from what a board says. */
export function mediaUrl(id: string, preview = false): string {
  const safe = /^[A-Za-z0-9_-]{8,40}$/.test(id) ? id : 'invalid0'
  return `/api/media/${safe}${preview ? '?preview=1' : ''}`
}

export function avatarUrl(person: { id: number; avatar: string | null }): string | null {
  return person.avatar ? `/api/avatars/${person.id}?v=${encodeURIComponent(person.avatar)}` : null
}
