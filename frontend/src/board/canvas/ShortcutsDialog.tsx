import { useTranslation } from 'react-i18next'

import { Dialog } from '../../components/Dialog'

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'keys.tools',
    rows: [
      ['V', 'tools.select'],
      ['H', 'tools.hand'],
      ['N', 'tools.note'],
      ['S', 'tools.shape'],
      ['T', 'tools.text'],
      ['L', 'tools.line'],
      ['F', 'tools.frame'],
      ['P', 'tools.pen'],
      ['M', 'tools.marker'],
      ['E', 'tools.eraser'],
      ['I', 'media.upload'],
    ],
  },
  {
    title: 'keys.edit',
    rows: [
      ['Ctrl Z', 'canvas.undo'],
      ['Ctrl Shift Z', 'canvas.redo'],
      ['Ctrl C / Ctrl V', 'keys.copyPaste'],
      ['Ctrl D', 'context.duplicate'],
      ['Ctrl G', 'context.group'],
      ['Ctrl Shift G', 'context.ungroup'],
      ['Shift', 'keys.rotateSteps'],
      ['Ctrl A', 'menu.selectAll'],
      ['Entf', 'context.delete'],
      ['Enter', 'keys.write'],
      ['← ↑ → ↓', 'keys.nudge'],
      ['Alt', 'keys.noSnap'],
    ],
  },
  {
    title: 'keys.view',
    rows: [
      ['Space', 'keys.pan'],
      ['Ctrl + Mausrad', 'keys.zoom'],
      ['+ / −', 'keys.zoomStep'],
      ['Shift 1', 'canvas.fit'],
      ['Ctrl 0', 'canvas.zoom100'],
      ['Ctrl K', 'search.button'],
      ['Alt N', 'board.new'],
    ],
  },
]

/** All keys at a glance, opened with "?" or from the board's menu. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Dialog title={t('keys.title')} onClose={onClose} wide>
      <div className="grid gap-6 sm:grid-cols-3">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-mist-500 uppercase">{t(group.title)}</h3>
            <dl className="space-y-1.5">
              {group.rows.map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-mist-300">{t(label)}</dt>
                  <dd>
                    <kbd>{key === 'Entf' ? t('keys.del') : key === 'Ctrl + Mausrad' ? t('keys.ctrlWheel') : key === 'Space' ? t('keys.space') : key}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
