import { ChevronDown, ChevronRight, Clock, LayoutDashboard, Plus, Star } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { useBoards } from '../board/store'
import { useNotices } from '../lib/notices'
import { useAuth } from '../state/auth'
import { useShell } from './AppShell'
import { NoticeList } from './Notices'

function Section({ title, children, open, onToggle, action }: { title: string; children: ReactNode; open: boolean; onToggle: () => void; action?: ReactNode }) {
  return (
    <section className="border-b border-ink-700/60 px-2.5 py-2.5">
      <div className="flex items-center">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex flex-1 items-center gap-1.5 px-1.5 py-1 text-[11px] font-semibold tracking-wider text-mist-500 uppercase hover:text-mist-100">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {title}
        </button>
        {action}
      </div>
      {open && <div className="mt-1 space-y-0.5">{children}</div>}
    </section>
  )
}

/** The left column of the overview, built like nexlore's: recent, favourites, spaces with their boards. */
export function Sidebar() {
  const { me } = useAuth()
  const { t } = useTranslation()
  const boards = useBoards()
  const shell = useShell()
  const [params] = useSearchParams()
  const chosen = params.get('space') ? Number(params.get('space')) : null
  const [open, setOpen] = useState({ recent: true, favorites: true })
  const [shut, setShut] = useState<Record<string, boolean>>({})
  const live = boards.boards.filter((b) => !b.deleted)
  const recent = [...live].sort((a, b) => b.opened - a.opened).slice(0, 3)
  const favorites = live.filter((b) => b.favorite)
  const notices = useNotices()

  const row = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-mist-400 hover:bg-ink-850 hover:text-mist-100'

  return (
    <aside className="nc-scroll hidden w-72 shrink-0 flex-col overflow-y-auto border-r border-ink-700/80 bg-ink-950/60 md:flex" aria-label={t('sidebar.label')}>
      {notices.length > 0 && (
        <section className="border-b border-ink-700/60 px-2.5 py-2.5" data-testid="sidebar-notices">
          <div className="px-1.5 py-1 text-[11px] font-semibold tracking-wider text-accent-400 uppercase">{t('notices.section', { count: notices.length })}</div>
          <div className="mt-1">
            <NoticeList notices={notices} />
          </div>
        </section>
      )}
      <Section title={t('sidebar.recent')} open={open.recent} onToggle={() => setOpen((o) => ({ ...o, recent: !o.recent }))}>
        {recent.map((b) => (
          <Link key={b.id} to={`/b/${b.id}`} className={row}>
            <Clock className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <span className="truncate">{b.title}</span>
          </Link>
        ))}
      </Section>
      <Section title={t('sidebar.favorites')} open={open.favorites} onToggle={() => setOpen((o) => ({ ...o, favorites: !o.favorites }))}>
        {favorites.length === 0 && <p className="px-2.5 py-1 text-xs text-mist-600">{t('sidebar.noFavorites')}</p>}
        {favorites.map((b) => (
          <Link key={b.id} to={`/b/${b.id}`} className={row}>
            <Star className="h-3.5 w-3.5 shrink-0 text-accent-400" />
            <span className="truncate">{b.title}</span>
          </Link>
        ))}
      </Section>
      <section className="px-2.5 py-2.5">
        <div className="flex items-center justify-between px-1.5">
          <span className="rounded-full bg-ink-850 px-3 py-1 text-[11px] font-semibold tracking-wider text-mist-100 uppercase">{t('sidebar.spaces')}</span>
          {/* Connected to nexsuite: spaces are made there. */}
          {me?.suite !== 'connected' && (
            <button type="button" className="rounded p-1 text-mist-500 hover:bg-ink-850 hover:text-mist-100" title={t('sidebar.newSpace')} aria-label={t('sidebar.newSpace')} onClick={() => shell.newSpace()}>
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-2 space-y-0.5">
          <Link to="/" className={row + (chosen === null ? ' bg-accent-500/12 text-mist-100' : '')}>
            <LayoutDashboard className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="font-semibold">{t('boards.all')}</span>
            <span className="ml-auto text-[11px] text-mist-600 tabular-nums">{live.length}</span>
          </Link>
          {boards.spaces.map((space) => {
            const inside = live.filter((b) => b.space === space.id)
            const isOpen = !shut[space.id]
            return (
              <div key={space.id}>
                <div className={'group flex items-center rounded-lg pr-1 ' + (chosen === space.id ? 'bg-accent-500/12' : 'hover:bg-ink-850')}>
                  <button type="button" onClick={() => setShut((s) => ({ ...s, [space.id]: isOpen }))} className="rounded p-1 text-mist-600 hover:text-mist-100" aria-expanded={isOpen} aria-label={isOpen ? t('sidebar.collapse') : t('sidebar.expand')}>
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                  <Link to={`/?space=${space.id}`} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-[13px] font-semibold text-mist-100">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: space.color }} />
                    <span className="truncate">{space.name}</span>
                    {/* nexsuite let it go: only the operator sees it now (B18). */}
                    {space.dropped && <span className="shrink-0 rounded-full border border-warn-500/40 px-1.5 text-[10px] font-medium text-warn-500" title={t('suite.droppedHint')} data-testid="space-dropped">{t('suite.dropped')}</span>}
                    <span className="ml-auto text-[11px] font-normal text-mist-600 tabular-nums opacity-0 group-hover:opacity-100">{inside.length}</span>
                  </Link>
                  {(space.role === 'write' || space.role === 'manage') && (
                    <button type="button" onClick={() => shell.newBoard(space.id)} className="shrink-0 rounded p-0.5 text-mist-500 opacity-0 group-hover:opacity-100 hover:bg-ink-800 hover:text-mist-100 focus-visible:opacity-100" title={t('board.newIn', { space: space.name })} aria-label={t('board.newIn', { space: space.name })}>
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {isOpen && (
                  <div className="ml-4 border-l border-ink-700/70 pl-2">
                    {inside.map((b) => (
                      <Link key={b.id} to={`/b/${b.id}`} className={row}>
                        <LayoutDashboard className="h-3.5 w-3.5 shrink-0 opacity-60" />
                        <span className="truncate">{b.title}</span>
                      </Link>
                    ))}
                    {inside.length === 0 && <p className="px-2.5 py-1 text-xs text-mist-600">{t('sidebar.nothingHere')}</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </aside>
  )
}
