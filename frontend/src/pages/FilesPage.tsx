import { FileText, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { mediaUrl } from '../api/client'
import { useBoards } from '../board/store'
import type { Board, FileItem, ImageItem } from '../board/types'
import { Dialog } from '../components/Dialog'
import { ago } from '../lib/time'
import { useTitle } from '../lib/title'

/** Every photo and file on the boards one can read, and the bin. As nexlore's files page. */
export function FilesPage() {
  const { t, i18n } = useTranslation()
  useTitle(t('nav.files'))
  const boards = useBoards()
  const [purging, setPurging] = useState<Board | null>(null)
  useEffect(() => {
    void boards.loadBin().catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const media = boards.boards.flatMap((b) =>
    b.items.filter((i): i is ImageItem | FileItem => i.kind === 'image' || i.kind === 'file').map((item) => ({ item, board: b })),
  )
  return (
    <main className="nc-scroll min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-10 px-4 py-6 sm:px-8 sm:py-8">
        <section>
          <h1 className="text-2xl font-bold tracking-tight text-mist-100">{t('nav.files')}</h1>
          <p className="mt-1 text-sm text-mist-600">{t('files.intro', { count: media.length })}</p>
          <div className="mt-5 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
            {media.map(({ item, board }) => (
              <Link key={board.id + item.id} to={`/b/${board.id}`} className="group overflow-hidden rounded-xl border border-ink-700 bg-ink-850 hover:border-ink-600">
                <div className="grid aspect-square place-items-center overflow-hidden bg-ink-800">
                  {item.kind === 'image' ? <img src={mediaUrl(item.media, true)} alt="" loading="lazy" className="h-full w-full object-cover" /> : <FileText className="h-10 w-10 text-mist-600" />}
                </div>
                <div className="p-2">
                  <div className="truncate text-xs text-mist-200">{item.kind === 'file' ? item.name : (item.caption ?? t('files.photo'))}</div>
                  <div className="truncate text-[11px] text-mist-600">{board.title}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-mist-100">{t('files.trash')}</h2>
          <p className="mt-1 text-sm text-mist-600">{t('files.trashHint')}</p>
          <ul className="mt-4 divide-y divide-ink-700/70 rounded-xl border border-ink-700 bg-ink-850">
            {boards.bin.length === 0 && <li className="px-4 py-3 text-sm text-mist-600">{t('files.trashEmpty')}</li>}
            {boards.bin.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <div className="truncate text-sm text-mist-100">{b.title}</div>
                  <div className="text-xs text-mist-600">
                    {boards.space(b.space)?.name} · {t('files.deleted', { when: ago(b.deleted!, i18n.language) })}
                  </div>
                </div>
                <button type="button" className="nc-btn nc-btn-ghost" onClick={() => void boards.restore(b.id)}>
                  <RotateCcw className="h-4 w-4" />
                  {t('files.restore')}
                </button>
                <button type="button" className="nc-btn text-bad-500 hover:bg-bad-500/10" onClick={() => setPurging(b)}>
                  <Trash2 className="h-4 w-4" />
                  {t('files.purge')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {purging && (
        <Dialog title={t('files.purgeTitle')} onClose={() => setPurging(null)}>
          <p className="text-sm text-mist-300">{t('files.purgeText', { title: purging.title })}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="nc-btn nc-btn-ghost" onClick={() => setPurging(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="nc-btn bg-bad-500 text-on-bad hover:opacity-90"
              onClick={async () => {
                await boards.purge(purging.id)
                setPurging(null)
              }}
            >
              {t('files.purge')}
            </button>
          </div>
        </Dialog>
      )}
    </main>
  )
}
