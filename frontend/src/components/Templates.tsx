import {
  Armchair,
  BookUser,
  Brain,
  CalendarDays,
  CalendarRange,
  ChartGantt,
  Columns3,
  Fish,
  GitBranch,
  Grid2x2,
  Images,
  LayoutDashboard,
  LayoutTemplate,
  Map as MapIcon,
  MessagesSquare,
  Milestone,
  Network,
  Server,
  Sofa,
  Square,
  Table2,
  Users,
  Workflow,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, ApiError } from '../api/client'
import { CATALOG, CATEGORIES, skeleton, type OwnTemplate } from '../board/templates'
import type { Doc } from '../board/types'
import { errorText } from '../lib/errors'
import { Dialog } from './Dialog'

// eslint-disable-next-line react-refresh/only-export-components
export const TEMPLATE_ICONS: Record<string, typeof Square> = {
  blank: Square,
  mood: Images,
  retro: MessagesSquare,
  kanban: Columns3,
  mindmap: Brain,
  week: CalendarDays,
  flowchart: Workflow,
  swimlanes: Table2,
  decision: GitBranch,
  gantt: ChartGantt,
  roadmap: MapIcon,
  kanbanWip: Columns3,
  milestones: Milestone,
  raci: Table2,
  brief: BookUser,
  flat: Sofa,
  office: LayoutDashboard,
  meeting: Armchair,
  seating: Users,
  homeNet: Network,
  rack: Server,
  vlans: Network,
  homelab: Server,
  mindmapLarge: Brain,
  swot: Grid2x2,
  businessModel: LayoutDashboard,
  empathy: Users,
  ishikawa: Fish,
  eisenhower: Grid2x2,
  startStop: MessagesSquare,
  fourL: Grid2x2,
  orgChart: GitBranch,
  month: CalendarRange,
}

/** What a new board starts from: a shipped template by id, or one a space or the server keeps. */
export type Start = { kind: 'shipped'; id: string } | { kind: 'own'; template: OwnTemplate }

/** The templates kept for the server and for the given spaces, each once. */
// eslint-disable-next-line react-refresh/only-export-components
export function useOwnTemplates(spaces: number[]): { list: OwnTemplate[]; reload: () => void } {
  const [list, setList] = useState<OwnTemplate[]>([])
  const [round, setRound] = useState(0)
  const key = spaces.join(',')
  useEffect(() => {
    let alive = true
    const asks = key ? key.split(',').map((space) => api<OwnTemplate[]>('/api/board-templates', { query: { space } })) : [api<OwnTemplate[]>('/api/board-templates')]
    Promise.all(asks.map((ask) => ask.catch(() => [] as OwnTemplate[]))).then((answers) => {
      if (!alive) return
      const seen = new Map<number, OwnTemplate>()
      for (const answer of answers) for (const template of answer) seen.set(template.key, template)
      setList([...seen.values()])
    })
    return () => {
      alive = false
    }
  }, [key, round])
  const reload = useCallback(() => setRound((n) => n + 1), [])
  return { list, reload }
}

/**
 * The choice of a starting point in the dialog for a new board: the shipped templates in their groups and the ones
 * kept for this space or the server, in a list that scrolls.
 */
export function TemplatePicker({ value, onChange, own }: { value: Start; onChange: (start: Start) => void; own: OwnTemplate[] }) {
  const { t } = useTranslation()
  const pressed = (start: Start) => (start.kind === 'shipped' && value.kind === 'shipped' ? start.id === value.id : start.kind === 'own' && value.kind === 'own' && start.template.key === value.template.key)
  const card = (start: Start, name: string, hint: string, Icon: typeof Square) => (
    <button
      key={start.kind === 'shipped' ? start.id : `own-${start.template.key}`}
      type="button"
      aria-pressed={pressed(start)}
      data-template={start.kind === 'shipped' ? start.id : `own-${start.template.key}`}
      onClick={() => onChange(start)}
      className={'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ' + (pressed(start) ? 'border-accent-500 bg-accent-500/10' : 'border-ink-700 hover:border-ink-600 hover:bg-ink-850')}
    >
      <Icon className={'mt-0.5 h-4 w-4 shrink-0 ' + (pressed(start) ? 'text-accent-400' : 'text-mist-500')} strokeWidth={1.8} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-mist-100">{name}</span>
        {hint && <span className="line-clamp-2 block text-xs text-mist-600">{hint}</span>}
      </span>
    </button>
  )
  return (
    <div className="nc-scroll max-h-80 space-y-3 overflow-y-auto pr-1">
      {own.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-mist-500 uppercase">{t('templates.own')}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{own.map((template) => card({ kind: 'own', template }, template.name, t(`templates.scope.${template.scope}`), LayoutTemplate))}</div>
        </section>
      )}
      {CATEGORIES.map((category) => (
        <section key={category}>
          <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-mist-500 uppercase">{t(`templates.categories.${category}`)}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CATALOG.filter((entry) => entry.category === category).map(({ id }) => card({ kind: 'shipped', id }, t(`templates.${id}.name`), t(`templates.${id}.hint`), TEMPLATE_ICONS[id] ?? LayoutTemplate))}
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * The open board kept as a template: for its space (managers) or for the whole server (the operator), whole or only
 * its frame ("without content").
 */
export function SaveTemplateDialog({ doc, title, space, spaceName, mayManage, operator, onClose, onSaved }: {
  doc: Doc
  title: string
  space: number
  spaceName: string
  mayManage: boolean
  operator: boolean
  onClose: () => void
  onSaved: (name: string) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(title)
  const [where, setWhere] = useState<'space' | 'server'>(mayManage ? 'space' : 'server')
  const [bare, setBare] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog title={t('templates.save.title')} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setProblem(null)
          try {
            const content = bare ? skeleton(doc) : doc
            await api('/api/board-templates', { method: 'POST', body: { space: where === 'space' ? space : null, name: name.trim(), content } })
            onSaved(name.trim())
          } catch (error) {
            setProblem(error instanceof ApiError ? error.code : 'internal_error')
            setBusy(false)
          }
        }}
      >
        <label className="block text-sm">
          <span className="text-xs font-medium text-mist-400">{t('templates.save.name')}</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="mt-1 h-9 w-full rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-mist-100 outline-none focus:border-accent-500" />
        </label>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-mist-400">{t('templates.save.where')}</legend>
          {mayManage && (
            <label className="flex items-center gap-2 text-sm text-mist-200">
              <input type="radio" name="where" checked={where === 'space'} onChange={() => setWhere('space')} className="accent-accent-500" />
              {t('templates.save.space', { space: spaceName })}
            </label>
          )}
          {operator && (
            <label className="flex items-center gap-2 text-sm text-mist-200">
              <input type="radio" name="where" checked={where === 'server'} onChange={() => setWhere('server')} className="accent-accent-500" />
              {t('templates.save.server')}
            </label>
          )}
        </fieldset>
        <label className="flex items-center justify-between gap-4 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-sm">
          <span>
            <span className="font-medium text-mist-100">{t('templates.save.bare')}</span>
            <span className="block text-xs text-mist-500">{t('templates.save.bareHint')}</span>
          </span>
          <input type="checkbox" checked={bare} onChange={(e) => setBare(e.target.checked)} className="h-5 w-5 shrink-0 accent-accent-500" />
        </label>
        {problem && (
          <p role="alert" className="text-sm text-bad-500">
            {errorText(problem)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="nc-btn nc-btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="nc-btn nc-btn-accent" disabled={busy || !name.trim()}>
            {t('templates.save.button')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
