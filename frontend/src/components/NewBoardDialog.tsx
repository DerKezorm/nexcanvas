import { FileUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { ApiError, boardsApi } from '../api/client'
import { useBoards } from '../board/store'
import { errorText } from '../lib/errors'
import { catalogDoc } from '../board/templates'
import type { Doc } from '../board/types'
import { Dialog } from './Dialog'
import { TemplatePicker, useOwnTemplates, type Start } from './Templates'
import { useSuiteConnected } from './Suite'
import { TITLE_MAX } from '../board/types'

/**
 * Name, space and a starting point. The space decides who sees the board, as in nexlore. A board can also come from a
 * file (JSON Canvas, as nexcanvas exports it, or from nexlore and Obsidian): it lands in the space chosen.
 */
export function NewBoardDialog({
  space,
  template = 'blank',
  onClose,
  onCreate,
  onNewSpace,
}: {
  space?: number
  template?: string
  onClose: () => void
  onCreate: (space: number, title: string, doc: Doc) => Promise<void>
  onNewSpace: () => void
}) {
  const { t, i18n } = useTranslation()
  const boards = useBoards()
  const writable = boards.spaces.filter((s) => s.role === 'write' || s.role === 'manage')
  const [title, setTitle] = useState('')
  const [where, setWhere] = useState<number>(space && writable.some((s) => s.id === space) ? space : (writable[0]?.id ?? 0))
  // Opened before the spaces arrived: the first one to write in, once they are there (else the choice shows a space
  // while none is chosen, and nothing can be made).
  const firstWritable = writable[0]?.id
  useEffect(() => {
    if (!where && firstWritable) setWhere(space && writable.some((s) => s.id === space) ? space : firstWritable)
  }, [where, firstWritable, space, writable])
  const [start, setStart] = useState<Start>({ kind: 'shipped', id: template.startsWith('own:') ? 'blank' : template })
  // The templates this space and the server keep, for the space chosen.
  const own = useOwnTemplates(where ? [where] : [])
  // Opened from a kept template (`own:<key>`): chosen once the list is there.
  const wanted = template.startsWith('own:') ? Number(template.slice(4)) : null
  useEffect(() => {
    const found = wanted ? own.list.find((o) => o.key === wanted) : undefined
    if (found) setStart({ kind: 'own', template: found })
  }, [wanted, own.list])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const name = title.trim() || t('board.untitled')
  const navigate = useNavigate()
  const file = useRef<HTMLInputElement>(null)
  const connected = useSuiteConnected()
  if (writable.length === 0) {
    // Connected, spaces and rights come from nexsuite: a new space here would only fail (Prüfgang F4).
    return (
      <Dialog title={t('board.new')} onClose={onClose}>
        <p className="text-sm text-mist-300">{connected ? t('board.noSpaceSuite') : t('board.noSpace')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="nc-btn nc-btn-ghost">
            {connected ? t('common.close') : t('common.cancel')}
          </button>
          {!connected && (
            <button type="button" onClick={onNewSpace} className="nc-btn nc-btn-accent">
              {t('sidebar.newSpace')}
            </button>
          )}
        </div>
      </Dialog>
    )
  }
  return (
    <Dialog title={t('board.new')} onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setProblem(null)
          try {
            const doc = start.kind === 'own' ? start.template.content : catalogDoc(start.id, (key, values) => t(key, values as never) as unknown as string, i18n.language)
            await onCreate(where, name, doc)
          } catch (error) {
            setProblem(error instanceof ApiError ? error.code : 'internal_error')
            setBusy(false)
          }
        }}
        className="space-y-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-mist-500">{t('board.name')}</span>
            <input className="nc-field" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder={t('board.untitled')} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-mist-500">{t('board.space')}</span>
            <select className="nc-field" value={where} onChange={(e) => setWhere(Number(e.target.value))}>
              {writable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-mist-500">{t('board.startWith')}</legend>
          <TemplatePicker value={start} onChange={setStart} own={own.list} />
        </fieldset>
        {problem && <p className="text-sm text-bad-500">{errorText(problem)}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={() => file.current?.click()} className="nc-btn nc-btn-ghost mr-auto" disabled={!where || busy} data-testid="board-from-file">
            <FileUp className="h-4 w-4" strokeWidth={1.8} />
            {t('board.fromFile')}
          </button>
          <input
            ref={file}
            type="file"
            accept=".canvas,.zip,application/json,application/zip"
            hidden
            aria-label={t('board.fromFile')}
            onChange={async (e) => {
              const chosen = e.target.files?.[0]
              e.target.value = ''
              if (!chosen) return
              setBusy(true)
              setProblem(null)
              try {
                const made = await boardsApi.fromFile(where, chosen, title.trim())
                await boards.refresh().catch(() => undefined)
                onClose()
                navigate(`/b/${made.board.id}`)
              } catch (error) {
                setProblem(error instanceof ApiError ? error.code : 'internal_error')
                setBusy(false)
              }
            }}
          />
          <button type="button" onClick={onClose} className="nc-btn nc-btn-ghost">
            {t('common.cancel')}
          </button>
          {/* Opened from a kept template: not before it is chosen, else the board would start empty. */}
          <button type="submit" className="nc-btn nc-btn-accent" disabled={!where || busy || (wanted !== null && start.kind !== 'own')}>
            {t('board.create')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
