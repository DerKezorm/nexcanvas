import { Copy, Globe, MoreHorizontal, Pencil, Plus, Star, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { PEOPLE } from '../board/demo'
import { useBoards } from '../board/store'
import { Thumb } from '../board/Thumb'
import type { Board } from '../board/types'
import { useShell } from '../components/AppShell'
import { Avatar } from '../components/Avatar'
import { Dialog } from '../components/Dialog'
import { MembersDialog } from '../components/MembersDialog'
import { Popover } from '../components/Popover'
import { Sidebar } from '../components/Sidebar'
import { ago } from '../lib/time'

type Sort = 'updated' | 'title' | 'created'

/** The overview: all boards or those of one space, as cards with a small picture. */
export function BoardsPage() {
  const { t, i18n } = useTranslation()
  const boards = useBoards()
  const shell = useShell()
  const [params] = useSearchParams()
  const spaceId = params.get('space')
  const space = spaceId ? boards.space(spaceId) : undefined
  const [sort, setSort] = useState<Sort>('updated')
  const [members, setMembers] = useState(false)
  const [renaming, setRenaming] = useState<Board | null>(null)

  const list = boards.boards
    .filter((b) => !b.deleted && (!space || b.space === space.id))
    .sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title, i18n.language) : sort === 'created' ? b.created - a.created : b.updated - a.updated))

  return (
    <>
      <Sidebar />
      <main className="nc-scroll min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-wrap items-center gap-3">
            {space && <span className="h-3 w-3 rounded-full" style={{ background: space.color }} />}
            <h1 className="text-2xl font-bold tracking-tight text-mist-100">{space ? space.name : t('boards.all')}</h1>
            {space && (
              <button type="button" onClick={() => setMembers(true)} className="ml-1 flex items-center gap-2 rounded-full border border-ink-700 py-1 pr-3 pl-1 text-xs text-mist-400 hover:bg-ink-850 hover:text-mist-100">
                <span className="flex -space-x-1.5">
                  {space.members.slice(0, 4).map((m) => (
                    <Avatar key={m.person} person={m.person} className="h-6 w-6 text-[11px]" ring />
                  ))}
                </span>
                <Users className="h-3.5 w-3.5" />
                {t('members.button', { count: space.members.length })}
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <label className="sr-only" htmlFor="sort">
                {t('boards.sort')}
              </label>
              <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-full border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm text-mist-300">
                <option value="updated">{t('boards.sortUpdated')}</option>
                <option value="title">{t('boards.sortTitle')}</option>
                <option value="created">{t('boards.sortCreated')}</option>
              </select>
            </div>
          </div>
          <p className="mt-1 text-sm text-mist-600">{t('boards.count', { count: list.length })}</p>

          <div className="mt-6 grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
            {(!space || space.role !== 'read') && (
              <button
                type="button"
                onClick={() => shell.newBoard(space?.id)}
                className="group flex aspect-[16/12] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-ink-700 text-mist-500 transition-colors hover:border-accent-500/70 hover:text-accent-400"
              >
                <span className="grid h-12 w-12 place-items-center rounded-full bg-ink-850 group-hover:bg-accent-500/15">
                  <Plus className="h-6 w-6" />
                </span>
                <span className="text-sm font-semibold">{t('board.new')}</span>
              </button>
            )}
            {list.map((board) => (
              <BoardCard key={board.id} board={board} onRename={() => setRenaming(board)} />
            ))}
          </div>
        </div>
      </main>
      {members && space && <MembersDialog space={space} onClose={() => setMembers(false)} />}
      {renaming && <RenameDialog board={renaming} onClose={() => setRenaming(null)} />}
    </>
  )
}

function BoardCard({ board, onRename }: { board: Board; onRename: () => void }) {
  const { t, i18n } = useTranslation()
  const boards = useBoards()
  const navigate = useNavigate()
  const space = boards.space(board.space)
  const others = (space?.members ?? []).filter((m) => PEOPLE.some((p) => p.id === m.person)).slice(0, 3)
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 transition-colors hover:border-ink-600">
      <Link to={`/b/${board.id}`} className="block aspect-[16/10] overflow-hidden border-b border-ink-700/70" aria-label={board.title}>
        <Thumb board={board} />
      </Link>
      <div className="flex items-start gap-2 p-3.5">
        <div className="min-w-0 flex-1">
          <Link to={`/b/${board.id}`} className="block truncate text-sm font-semibold text-mist-100 hover:text-accent-400">
            {board.title}
          </Link>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-mist-600">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: space?.color }} />
            <span className="truncate">{space?.name}</span>
            <span>·</span>
            <span className="truncate">{ago(board.updated, i18n.language)}</span>
            {board.publicLink && <Globe className="h-3 w-3 shrink-0 text-accent-400" aria-label={t('share.publicOn')} />}
          </div>
        </div>
        {others.length > 1 && (
          <span className="mt-0.5 flex -space-x-1.5">
            {others.map((m) => (
              <Avatar key={m.person} person={m.person} className="h-5 w-5 text-[10px]" ring />
            ))}
          </span>
        )}
      </div>
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          onClick={() => boards.patch(board.id, { favorite: !board.favorite })}
          aria-pressed={board.favorite}
          aria-label={board.favorite ? t('board.unfavorite') : t('board.favorite')}
          title={board.favorite ? t('board.unfavorite') : t('board.favorite')}
          className="nc-float grid h-8 w-8 place-items-center rounded-full"
        >
          <Star className={'h-4 w-4 ' + (board.favorite ? 'fill-accent-500 text-accent-500' : 'text-mist-400')} />
        </button>
        <Popover label={t('common.more')} className="nc-float grid h-8 w-8 place-items-center rounded-full" button={<MoreHorizontal className="h-4 w-4 text-mist-400" />}>
          {(close) => (
            <>
              <button type="button" role="menuitem" className="nc-menu-item" onClick={() => { close(); onRename() }}>
                <Pencil className="h-4 w-4 text-mist-500" />
                {t('board.rename')}
              </button>
              <button type="button" role="menuitem" className="nc-menu-item" onClick={() => { close(); navigate(`/b/${boards.duplicate(board.id, t('board.copyOf', { title: board.title }))}`) }}>
                <Copy className="h-4 w-4 text-mist-500" />
                {t('board.duplicate')}
              </button>
              <div className="my-1 h-px bg-ink-700" />
              <button type="button" role="menuitem" className="nc-menu-item text-bad-500" onClick={() => { close(); boards.trash(board.id) }}>
                <Trash2 className="h-4 w-4" />
                {t('board.trash')}
              </button>
            </>
          )}
        </Popover>
      </div>
      {board.favorite && <Star className="pointer-events-none absolute top-3.5 left-3.5 h-4 w-4 fill-accent-500 text-accent-500 drop-shadow group-hover:opacity-0" aria-hidden="true" />}
    </article>
  )
}

function RenameDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const { t } = useTranslation()
  const boards = useBoards()
  const [title, setTitle] = useState(board.title)
  return (
    <Dialog title={t('board.rename')} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim()) boards.patch(board.id, { title: title.trim() })
          onClose()
        }}
        className="space-y-4"
      >
        <input className="nc-field" value={title} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.target.select()} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="nc-btn nc-btn-ghost">
            {t('common.cancel')}
          </button>
          <button type="submit" className="nc-btn nc-btn-accent">
            {t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
