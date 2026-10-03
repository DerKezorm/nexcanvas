/** Light, dark or as the system: a new browser without a choice follows the system, as nexlore does. */
import { applyMode, storedMode, storedTheme } from './theme'

function system(light: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: light && query.includes('light'), addEventListener: () => undefined }))
}

describe('the mode', () => {
  beforeEach(() => {
    const kept = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.removeAttribute('data-theme')
  })

  it('follows the system while nothing was chosen', () => {
    system(true)
    expect(storedMode()).toBe('system')
    expect(storedTheme()).toBe('light')
    system(false)
    expect(storedTheme()).toBe('dark')
  })

  it('keeps a choice, and the system again when that is chosen', () => {
    system(true)
    applyMode('dark')
    expect([storedMode(), storedTheme()]).toEqual(['dark', 'dark'])
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    applyMode('system')
    expect([storedMode(), storedTheme()]).toEqual(['system', 'light'])
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
