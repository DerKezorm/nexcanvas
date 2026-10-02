import { useTranslation } from 'react-i18next'

import { Thumb } from '../board/Thumb'
import { TEMPLATES, templateDoc } from '../board/templates'
import { useShell } from '../components/AppShell'
import { TEMPLATE_ICONS } from '../components/NewBoardDialog'

/** Starting points, each with a picture of what it puts on the board. */
export function TemplatesPage() {
  const { t } = useTranslation()
  const shell = useShell()
  return (
    <main className="nc-scroll min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        <h1 className="text-2xl font-bold tracking-tight text-mist-100">{t('nav.templates')}</h1>
        <p className="mt-1 text-sm text-mist-600">{t('templates.intro')}</p>
        <div className="mt-6 grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
          {TEMPLATES.map((id) => {
            const Icon = TEMPLATE_ICONS[id]
            const doc = templateDoc(id, t)
            return (
              <button key={id} type="button" onClick={() => shell.newBoard(undefined, id)} className="group overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 text-left transition-colors hover:border-accent-500/60">
                <div className="aspect-[16/10] border-b border-ink-700/70">
                  <Thumb board={{ id, title: id, items: doc.items, lines: doc.lines, created: 0, updated: 0, opened: 0, favorite: false, space: '', publicLink: false }} />
                </div>
                <div className="flex items-start gap-3 p-3.5">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-mist-500 group-hover:text-accent-400" strokeWidth={1.8} />
                  <span>
                    <span className="block text-sm font-semibold text-mist-100">{t(`templates.${id}.name`)}</span>
                    <span className="block text-xs text-mist-600">{t(`templates.${id}.hint`)}</span>
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </main>
  )
}
