import { Brain, CalendarDays, Columns3, Images, MessagesSquare, Square } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '../api/client'
import { useBoards } from '../board/store'
import { errorText } from '../lib/errors'
import { TEMPLATES, type TemplateId } from '../board/templates'
import { Dialog } from './Dialog'

// eslint-disable-next-line react-refresh/only-export-components
export const TEMPLATE_ICONS: Record<TemplateId, typeof Square> = {
  blank: Square,
  mood: Images,
  retro: MessagesSquare,
  kanban: Columns3,
  mindmap: Brain,
  week: CalendarDays,
}

/** Name, space and a starting point. The space decides who sees the board, as in nexlore. */
export function NewBoardDialog({
  space,
  template = 'blank',
  onClose,
  onCreate,
  onNewSpace,
}: {
  space?: number
  template?: TemplateId
  onClose: () => void
  onCreate: (space: number, title: string, template: TemplateId) => Promise<void>
  onNewSpace: () => void
}) {
  const { t } = useTranslation()
  const boards = useBoards()
  const writable = boards.spaces.filter((s) => s.role === 'write' || s.role === 'manage')
  const [title, setTitle] = useState('')
  const [where, setWhere] = useState<number>(space && writable.some((s) => s.id === space) ? space : (writable[0]?.id ?? 0))
  const [start, setStart] = useState<TemplateId>(template)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const name = title.trim() || t('board.untitled')
  if (writable.length === 0) {
    return (
      <Dialog title={t('board.new')} onClose={onClose}>
        <p className="text-sm text-mist-300">{t('board.noSpace')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="nc-btn nc-btn-ghost">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={onNewSpace} className="nc-btn nc-btn-accent">
            {t('sidebar.newSpace')}
          </button>
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
            await onCreate(where, name, start)
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
            <input className="nc-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('board.untitled')} />
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TEMPLATES.map((id) => {
              const Icon = TEMPLATE_ICONS[id]
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={start === id}
                  onClick={() => setStart(id)}
                  className={
                    'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ' +
                    (start === id ? 'border-accent-500 bg-accent-500/10' : 'border-ink-700 hover:border-ink-600 hover:bg-ink-850')
                  }
                >
                  <Icon className={'mt-0.5 h-4 w-4 shrink-0 ' + (start === id ? 'text-accent-400' : 'text-mist-500')} strokeWidth={1.8} />
                  <span>
                    <span className="block text-sm font-medium text-mist-100">{t(`templates.${id}.name`)}</span>
                    <span className="block text-xs text-mist-600">{t(`templates.${id}.hint`)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </fieldset>
        {problem && <p className="text-sm text-bad-500">{errorText(problem)}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="nc-btn nc-btn-ghost">
            {t('common.cancel')}
          </button>
          <button type="submit" className="nc-btn nc-btn-accent" disabled={!where || busy}>
            {t('board.create')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
