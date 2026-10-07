/** The two shipped languages have the same keys, the same placeholders, and no dashes as pauses. */

import de from './de.json'
import en from './en.json'
import whatsNewDe from './whatsnew/de.json'
import whatsNewEn from './whatsnew/en.json'

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

  it('count with figures throughout the backup line, never a figure next to a word', () => {
    for (const key of ['server.countBoards_one', 'server.countFiles_one']) {
      expect(german.get(key), key).toContain('{{count}}')
      expect(english.get(key), key).toContain('{{count}}')
    }
  })

  it('call the program version Version in German; Fassung is left for what is on a board (decided 06.10.2026)', () => {
    const about = [...german].filter(([key]) => key.startsWith('about.'))
    expect(about.filter(([, text]) => /Fassung/.test(text)).map(([key, text]) => `${key}: ${text}`)).toEqual([])
    expect(german.get('about.version')).toBe('Version')
    expect(german.get('about.updates.current')).toBe('Das ist die neueste Version.')
  })
})

/** Every text in a tree of entries, however deep, arrays included. */
function strings(tree: unknown): string[] {
  if (typeof tree === 'string') return [tree]
  if (tree && typeof tree === 'object') return Object.values(tree).flatMap(strings)
  return []
}

/**
 * The program version in German, as a phrase: "Fassung 1.2", "Fassung von nexcanvas", "eine neue Fassung", "die erste
 * Fassung", "je Fassung", "Alle Fassungen und was sich geändert hat". What belongs to content may keep the word: "eine
 * neue Fassung einer Notiz", "Welche Fassung bleibt".
 */
const PROGRAM_FASSUNG =
  /Fassung\s+(?:\d|von\s+nex)|\b(?:neue|neuen|neuere|neueren|neueste|neuesten|erste|ersten|diese|dieser|jede|jeder|je|nächste|nächsten)\s+Fassung(?!en)(?!\s+(?:einer|eines|der|des|deiner|deines)\b)|Fassungen\s+und\s+was/

describe('what is new', () => {
  const german = strings(whatsNewDe)
  const english = strings(whatsNewEn)

  it('call the program version Version in German, in released entries too (decided 06.10.2026)', () => {
    expect(german.filter((text) => PROGRAM_FASSUNG.test(text))).toEqual([])
    // Floor: the entries are read at all.
    expect(german.length).toBeGreaterThan(20)
  })

  it('say trash in English (decided 06.10.2026)', () => {
    expect(english.filter((text) => /\bbins?\b/i.test(text))).toEqual([])
    expect(english.length).toBeGreaterThan(20)
  })

  it('never name nexsuite, which is not released (as in the release notes)', () => {
    expect([...german, ...english].filter((text) => /nexsuite/i.test(text))).toEqual([])
  })

  it('tell the operator where to switch team leads back on in 0.3.0 (the switch is off after the update)', () => {
    const entry = (whatsNewDe as Record<string, { sections: { where: string }[] }>)['0.3.0']
    expect(entry.sections.map((section) => section.where)).toContain('Einstellungen, Teams, Schalter „Teamleitungen ändern ihre Teams“')
    expect(de.teams.leadsSwitch).toBe('Teamleitungen ändern ihre Teams')
  })

  it('know the program version when they see it, and leave the versions of content alone', () => {
    for (const text of ['Fassung 1.4.0 ist da.', 'eine neuere Fassung von nexlore', 'Die erste Fassung von nexcanvas:', 'kommt einmal je Fassung', 'Vor dieser Fassung ging es', 'Alle Fassungen und was sich geändert hat']) {
      expect(PROGRAM_FASSUNG.test(text), text).toBe(true)
    }
    for (const text of ['Jede gespeicherte Fassung einer Notiz', 'eine neue Fassung einer Notiz', 'Welche Fassung bleibt', 'bekommen eine WebP-Fassung']) {
      expect(PROGRAM_FASSUNG.test(text), text).toBe(false)
    }
  })
})
