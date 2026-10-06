/** The two shipped languages have the same keys, the same placeholders, and no dashes as pauses. */

import de from './de.json'
import en from './en.json'

function flat(tree: Record<string, unknown>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    if (value && typeof value === 'object') for (const [k, v] of flat(value as Record<string, unknown>, `${prefix}${key}.`)) out.set(k, v)
    else out.set(prefix + key, String(value))
  }
  return out
}

const german = flat(de)
const english = flat(en)

describe('shipped languages', () => {
  it('have exactly the same keys', () => {
    expect([...german.keys()].filter((key) => !english.has(key))).toEqual([])
    expect([...english.keys()].filter((key) => !german.has(key))).toEqual([])
  })

  it('use the same placeholders for each key', () => {
    const holes = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
    const different = [...german].filter(([key, text]) => JSON.stringify(holes(text)) !== JSON.stringify(holes(english.get(key) ?? '')))
    expect(different.map(([key]) => key)).toEqual([])
  })

  it('never pause with a dash', () => {
    const dashed = [...german, ...english].filter(([, text]) => /[–—]/.test(text))
    expect(dashed.map(([key]) => key)).toEqual([])
  })

  it('say trash in English, never bin (decided 06.10.2026)', () => {
    expect([...english].filter(([, text]) => /\bbins?\b/i.test(text)).map(([key, text]) => `${key}: ${text}`)).toEqual([])
    // Floor: the trash is still spoken of, so the check above has something to look at.
    expect([...english].filter(([, text]) => /\btrash\b/i.test(text)).length).toBeGreaterThan(5)
  })

  it('call the program version Version in German; Fassung is left for what is on a board (decided 06.10.2026)', () => {
    const about = [...german].filter(([key]) => key.startsWith('about.'))
    expect(about.filter(([, text]) => /Fassung/.test(text)).map(([key, text]) => `${key}: ${text}`)).toEqual([])
    expect(german.get('about.version')).toBe('Version')
    expect(german.get('about.updates.current')).toBe('Das ist die neueste Version.')
  })
})
