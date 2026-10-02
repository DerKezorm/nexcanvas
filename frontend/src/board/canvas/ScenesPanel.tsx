import { Frame, Play, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { paint } from '../palette'
import type { FrameItem } from '../types'

/** The frames of the board as a list: a click shows one, the play button presents from there. */
export function ScenesPanel({ frames, onShow, onPresent, onClose }: { frames: FrameItem[]; onShow: (frame: FrameItem) => void; onPresent: (from: number) => void; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <section className="nc-float w-72 max-w-[calc(100vw-5rem)] p-2" aria-label={t('frames.scenes')}>
      <div className="flex items-center justify-between px-1.5 pb-1.5">
        <h2 className="text-sm font-semibold text-mist-100">{t('frames.scenes')}</h2>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-mist-500 hover:bg-ink-800 hover:text-mist-100" aria-label={t('common.close')}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {frames.length === 0 ? (
        <p className="px-1.5 pb-1.5 text-xs leading-relaxed text-mist-500">{t('frames.noneHint')}</p>
      ) : (
        <>
          <ol className="max-h-72 space-y-0.5 overflow-y-auto">
            {frames.map((frame, n) => (
              <li key={frame.id} className="group flex items-center gap-1 rounded-lg hover:bg-ink-800">
                <button type="button" onClick={() => onShow(frame)} className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1.5 text-left text-sm text-mist-200">
                  <span className="w-4 shrink-0 text-right text-[11px] text-mist-600 tabular-nums">{n + 1}</span>
                  <Frame className="h-3.5 w-3.5 shrink-0" style={{ color: paint(frame.color) }} />
                  <span className="truncate">{frame.title || t('frames.untitled')}</span>
                </button>
                <button type="button" onClick={() => onPresent(n)} className="mr-1 rounded-md p-1 text-mist-500 opacity-0 group-hover:opacity-100 hover:text-accent-400 focus:opacity-100" aria-label={t('frames.presentFrom', { title: frame.title || t('frames.untitled') })} title={t('frames.presentFrom', { title: frame.title || t('frames.untitled') })}>
                  <Play className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => onPresent(0)} className="nc-btn nc-btn-accent mt-2 w-full justify-center">
            <Play className="h-4 w-4" />
            {t('frames.present')}
          </button>
        </>
      )}
    </section>
  )
}
