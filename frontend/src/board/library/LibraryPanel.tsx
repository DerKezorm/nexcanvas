import { ChevronDown, ChevronRight, PanelLeftClose, Search, Shapes, Star, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { ShapeTile } from './LibShape'
import { useLibrary } from './registry'
import { named, shapeKey, type ShapeDef, type ShapePackage } from './types'

/** The mime type a shape travels under when dragged onto the board. */
export const SHAPE_DRAG = 'application/x-nexcanvas-shape'

const GROUPS_KEY = 'nexcanvas.libraryGroups'

function storedGroups(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

/** Folded case and without accents, so "kuche" finds "Küche". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

type Entry = { key: string; def: ShapeDef; pkg: ShapePackage; hay: string }

/** How many shapes a group or a search shows before "show all": the icon packages hold hundreds. */
const SHOWN = 64

/**
 * The shape library on the left of the board, as Visio's stencils: a search over every shape, the starred ones, the
 * ones taken last, and each package as a group that folds. A shape is dragged onto the board, or clicked and then
 * drawn there. Folded, the library is a column of the last shapes; on a phone it comes up from below.
 */
export function LibraryPanel({
  open,
  onOpen,
  onClose,
  active,
  onPick,
  favorites,
  recent,
  onFavorite,
  space,
  sheet = false,
}: {
  open: boolean
  onOpen: () => void
  onClose: () => void
  active: string | undefined
  onPick: (key: string) => void
  favorites: string[]
  recent: string[]
  onFavorite: (key: string, on: boolean) => void
  space: number | undefined
  sheet?: boolean
}) {
  const { t, i18n } = useTranslation()
  const { packages, lookup } = useLibrary()
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState<Record<string, boolean>>(storedGroups)
  /** Groups and the search shown in full past the first shapes. */
  const [whole, setWhole] = useState<Record<string, boolean>>({})
  const lang = i18n.language

  const entries = useMemo<Entry[]>(
    () => packages.flatMap((pkg) => pkg.shapes.map((def) => ({ key: shapeKey(pkg.id, def.id), def, pkg, hay: fold([...Object.values(def.name), ...(def.words ?? []), ...Object.values(pkg.name)].join(' ')) }))),
    [packages],
  )
  const found = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean)
    if (!words.length) return null
    return entries.filter(({ hay }) => words.every((w) => hay.includes(w)))
  }, [entries, query])
  const pick = (keys: string[]) => keys.map((key) => entries.find((e) => e.key === key) ?? (lookup(key) ? { key, def: lookup(key)!, pkg: packages[0], hay: '' } : null)).filter((e): e is Entry => e !== null)

  const toggleGroup = (id: string, isOpen: boolean) => {
    const next = { ...groups, [id]: !isOpen }
    setGroups(next)
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(next))
    } catch {
      // Only a convenience.
    }
  }

  const tile = (entry: Entry) => {
    const name = named(entry.def.name, lang)
    const starred = favorites.includes(entry.key)
    return (
      <div key={entry.key} className="group relative">
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(SHAPE_DRAG, entry.key)
            e.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => onPick(entry.key)}
          aria-pressed={active === entry.key}
          title={name}
          aria-label={name}
          data-shape={entry.key}
          className={'grid h-14 w-full place-items-center rounded-xl transition-colors ' + (active === entry.key ? 'bg-accent-500/15 ring-1 ring-accent-500/60' : 'hover:bg-ink-800')}
        >
          <ShapeTile def={entry.def} size={34} />
        </button>
        <button
          type="button"
          onClick={() => onFavorite(entry.key, !starred)}
          aria-label={starred ? t('library.unstar', { name }) : t('library.star', { name })}
          aria-pressed={starred}
          className={'absolute top-0.5 right-0.5 rounded p-0.5 ' + (starred ? 'text-accent-400' : 'text-mist-600 opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
        >
          <Star className="h-3 w-3" fill={starred ? 'currentColor' : 'none'} />
        </button>
      </div>
    )
  }

  const grid = (list: Entry[]) => <div className="grid grid-cols-4 gap-1">{list.map(tile)}</div>
  /** A grid that shows the first shapes and a button for the rest. */
  const limited = (id: string, list: Entry[]) => (
    <>
      {grid(whole[id] ? list : list.slice(0, SHOWN))}
      {!whole[id] && list.length > SHOWN && (
        <button type="button" onClick={() => setWhole((w) => ({ ...w, [id]: true }))} className="mt-1 w-full rounded-lg px-2 py-1.5 text-xs text-accent-400 hover:bg-ink-800">
          {t('library.showAll', { count: list.length })}
        </button>
      )}
    </>
  )
  const heading = 'px-1 pt-3 pb-1.5 text-[11px] font-semibold tracking-wider text-mist-500 uppercase'

  if (!open && !sheet) {
    // Folded: a narrow column with the last shapes, one click from drawing again.
    return (
      <aside data-ui data-testid="library" data-open="false" className="nc-float absolute top-3 left-3 z-20 flex w-14 flex-col items-center gap-1 p-1.5">
        <button type="button" onClick={onOpen} className="nc-tool" title={t('library.open')} aria-label={t('library.open')}>
          <Shapes className="h-5 w-5" strokeWidth={1.8} />
        </button>
        {pick(recent).slice(0, 6).map((entry) => (
          <button key={entry.key} type="button" onClick={() => onPick(entry.key)} title={named(entry.def.name, lang)} aria-label={named(entry.def.name, lang)} aria-pressed={active === entry.key} className={'grid h-10 w-10 place-items-center rounded-lg ' + (active === entry.key ? 'bg-accent-500/15' : 'hover:bg-ink-800')}>
            <ShapeTile def={entry.def} size={26} />
          </button>
        ))}
      </aside>
    )
  }

  return (
    <aside
      data-ui
      data-testid="library"
      data-open="true"
      aria-label={t('library.title')}
      className={sheet ? 'nc-float fixed inset-x-2 bottom-2 z-40 flex max-h-[70dvh] flex-col p-2' : 'nc-float absolute top-3 bottom-20 left-3 z-20 flex w-72 flex-col p-2'}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        <Shapes className="h-4 w-4 text-accent-400" strokeWidth={1.8} />
        <h2 className="flex-1 text-sm font-semibold text-mist-100">{t('library.title')}</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-mist-500 hover:bg-ink-800 hover:text-mist-100" title={sheet ? t('common.close') : t('library.fold')} aria-label={sheet ? t('common.close') : t('library.fold')}>
          {sheet ? <X className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>
      <label className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 text-mist-500" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('library.search')} aria-label={t('library.search')} className="min-w-0 flex-1 bg-transparent text-sm text-mist-100 outline-none placeholder:text-mist-600" />
      </label>
      <div className="nc-scroll -mx-1 mt-1 min-h-0 flex-1 overflow-y-auto px-1">
        {found ? (
          <>
            <p className={heading}>{t('library.found', { count: found.length })}</p>
            {found.length ? limited(`search:${query}`, found) : <p className="px-1 text-xs text-mist-500">{t('library.nothing')}</p>}
          </>
        ) : (
          <>
            {favorites.length > 0 && (
              <>
                <p className={heading}>{t('library.favorites')}</p>
                {grid(pick(favorites))}
              </>
            )}
            {recent.length > 0 && (
              <>
                <p className={heading}>{t('library.recent')}</p>
                {grid(pick(recent).slice(0, 8))}
              </>
            )}
            {packages.map((pkg) => {
              const isOpen = groups[pkg.id] ?? pkg.id === 'basic'
              return (
                <section key={pkg.id} data-package={pkg.id}>
                  <button type="button" onClick={() => toggleGroup(pkg.id, isOpen)} aria-expanded={isOpen} className="flex w-full items-center gap-1.5 rounded-lg px-1 pt-3 pb-1.5 text-left text-[11px] font-semibold tracking-wider text-mist-500 uppercase hover:text-mist-100">
                    {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    <span className="flex-1 truncate">{named(pkg.name, lang)}</span>
                    {pkg.scope !== 'builtin' && <span className="rounded-full bg-ink-800 px-1.5 py-px text-[10px] font-medium tracking-normal normal-case">{t(`library.scope.${pkg.scope}`)}</span>}
                    <span className="font-normal tabular-nums">{pkg.shapes.length}</span>
                  </button>
                  {isOpen && limited(pkg.id, pkg.shapes.map((def) => ({ key: shapeKey(pkg.id, def.id), def, pkg, hay: '' })))}
                </section>
              )
            })}
          </>
        )}
      </div>
      <div className="border-t border-ink-700 px-1 pt-2 text-xs">
        <p className="text-mist-500">{t('library.hint')}</p>
        <div className="mt-1 flex flex-wrap gap-x-3">
          <Link to="/account?tab=shapes" className="text-accent-400 hover:underline">
            {t('library.choose')}
          </Link>
          <Link to={space ? `/settings?tab=spaces&packages=${space}` : '/settings?tab=spaces'} className="text-accent-400 hover:underline">
            {t('library.manage')}
          </Link>
        </div>
      </div>
    </aside>
  )
}
