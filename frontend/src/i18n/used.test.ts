/**
 * Every shipped text is asked for somewhere, numbers count right, and English is English (Prüfgang H3, H10, H15).
 * "Download template" (Settings, General) hands every key to translators: a text no page shows is work for nothing,
 * and a sentence of another app (a vault, notes, a task) told them nexcanvas had it.
 *
 * A key counts as asked for when the code names it, or names its start in a built key (`notices.${kind}`,
 * `auth.invite.intoSpace${by}`). The error texts are checked against the server's codes in
 * `backend/tests/test_texts.py`.
 */

import de from './de.json'
import en from './en.json'

type Files = {
  readFileSync: (file: string, encoding: string) => string
  readdirSync: (folder: string, options: { recursive: true }) => string[]
}
const fsName = 'node:fs'
const files = (await import(/* @vite-ignore */ fsName)) as Files

function flat(tree: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    value && typeof value === 'object' ? flat(value as Record<string, unknown>, `${prefix}${key}.`) : [prefix + key],
  )
}

const source = files
  .readdirSync('src', { recursive: true })
  .map((name) => name.replaceAll('\\', '/'))
  // The shared sign-in module (`vendor/nexoidc`) brings its own texts and is checked by its own test.
  .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.') && !name.startsWith('i18n/') && !name.startsWith('vendor/'))
  .map((name) => files.readFileSync(`src/${name}`, 'utf-8'))
  .join('\n')

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function askedFor(key: string): boolean {
  const base = key.replace(/_(one|other|zero)$/, '')
  if (source.includes(base)) return true
  // A key with a built end: `auth.invite.intoSpace${by}` asks for intoSpace and intoSpaceBy.
  const stem = base.replace(/[A-Z][a-z]*$/, '')
  if (stem !== base && new RegExp(`['\`]${escape(stem)}\\$\\{`).test(source)) return true
  const parts = base.split('.')
  for (let end = parts.length - 1; end > 0; end--) {
    const start = parts.slice(0, end).join('.') + '.'
    if (new RegExp(`['\`]${escape(start)}\\$\\{`).test(source)) return true
  }
  return false
}

const text = (tree: unknown, key: string) => String(key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], tree))

describe('the shipped texts', () => {
  it('are all asked for by some page', () => {
    const unused = flat(de).filter((key) => !key.startsWith('errors.') && !askedFor(key))
    expect(unused).toEqual([])
  })

  it('have every key a page asks for, in both languages', () => {
    // A key named whole in the code: t('board.back'), i18nKey="…", or a constant handed to t() later (label:
    // 'nav.boards'). Built keys (`notices.${kind}`) are left to the check above. A deleted key showed its bare name
    // as the label of the back arrow (Prüfer block 4).
    const spaces = new Set(Object.keys(de))
    const keys = new Set(flat(de))
    const english = new Set(flat(en))
    const has = (set: Set<string>, key: string) => set.has(key) || set.has(`${key}_one`) || set.has(`${key}_other`)
    const asked = [...source.matchAll(/['"`]([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)['"`]/g)]
      .map((m) => m[1])
      .filter((key) => spaces.has(key.split('.')[0]) && !/\.(tsx?|json|svg|png|css|js)$/.test(key))
    expect(asked.length).toBeGreaterThan(500)
    expect([...new Set(asked.filter((key) => !has(keys, key) || !has(english, key)))]).toEqual([])
  })

  it('speak English, not German word for word', () => {
    // "Angeben" is enter, "anlegen" is create, "enthalten" is contain, "abgelaufen" is expired (WORTLAUTE.md).
    const stiff = flat(en).filter((key) =>
      /\bGive (a|an|the|your)\b|\bMake (a|an|one|them|new|it)\b|\bmakes? (a|an|new|its|their)\b|\b(runs?|ran) out\b|\bWhole:|\bhangs on\b|\bthe own\b|\bTake (the )?second factor\b/i.test(text(en, key)) ||
      // "holds" for "gilt" or "enthält"; a key one holds down while dragging stays ("Hold while dragging").
      /\bholds?\b|\bHolds\b/.test(text(en, key)),
    )
    expect(stiff.map((key) => `${key}: ${text(en, key)}`)).toEqual([])
    // Floor: the keys that hold a key down are read and let through.
    expect(text(en, 'keys.pan')).toMatch(/^Hold /)
  })

  it('count with a word for one, never "1 Personen"', () => {
    // A text with {{count}} and a noun after it has its _one form (Prüfgang H1, as nextasks).
    const counted = flat(de).filter((key) => !/_(one|other|zero)$/.test(key) && /\{\{count\}\} \p{Lu}/u.test(text(de, key)))
    expect(counted).toEqual([])
    expect(text(de, 'members.teamPeople_one')).toBe('eine Person')
  })

  it('speak of nexcanvas only', () => {
    const raw = [de, en].map((tree) => JSON.stringify(tree)).join('\n')
    expect(raw.match(/notes\.example\.com|wie in nexlore|as in nexlore|nextrmnl|Tresor|vault|KI in Notizen|Give an address/g)).toBeNull()
  })
})
