import { Eye, EyeOff, ScanEye } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { paint } from '../palette'
import type { FrameItem } from '../types'

function Knob({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="pointer-events-auto flex items-center gap-[0.4em] rounded-lg border border-ink-600 bg-ink-900/90 px-[0.8em] py-[0.4em] font-medium whitespace-nowrap text-mist-100 hover:bg-ink-800"
    >
      {children}
    </button>
  )
}

/**
 * What lies over a frame whose content is hidden: a closed cover for everybody, the one who hid it too, since on a
 * projector the whole class looks at that one screen. It answers as the frame does (picked, moved and named like it),
 * and what is under it is not drawn at all. Who may show it gets two buttons on it: show it to everybody, or look
 * inside on this screen only (`peeking`, until closed again or the page is loaded anew).
 */
export function HiddenCover({ frame, peeking, mayShow, onShow, onPeek }: {
  frame: FrameItem
  peeking: boolean
  mayShow: boolean
  onShow: () => void
  onPeek: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const color = paint(frame.color)
  const box = { left: frame.x, top: frame.y, width: frame.w, height: frame.h }
  const label = { fontSize: 'calc(13px / var(--zoom, 1))' }
  if (peeking) {
    return (
      <div className="pointer-events-none absolute rounded-[14px] border-2 border-dashed" style={{ ...box, borderColor: color }} data-hidden-frame={frame.id} data-inside="">
        <div className="absolute flex items-center gap-[0.5em]" style={{ ...label, top: 'calc(8px / var(--zoom, 1))', right: 'calc(8px / var(--zoom, 1))' }}>
          <span className="flex items-center gap-1 rounded-md bg-ink-900/85 px-1.5 py-0.5 font-medium whitespace-nowrap text-mist-300">
            <ScanEye style={{ width: '1.1em', height: '1.1em' }} />
            {t('hide.peeking')}
          </span>
          <Knob label={t('hide.closePeek')} onClick={() => onPeek(false)}>
            <EyeOff style={{ width: '1.1em', height: '1.1em' }} />
            {t('hide.closePeek')}
          </Knob>
        </div>
      </div>
    )
  }
  return (
    <div
      data-item={frame.id}
      data-hidden-frame={frame.id}
      className="absolute flex flex-col items-center justify-center gap-[0.6em] overflow-hidden rounded-[14px] border text-mist-400"
      style={{
        ...box,
        borderColor: color,
        background: `repeating-linear-gradient(135deg, var(--color-ink-850) 0 14px, var(--color-ink-800) 14px 28px)`,
        ...label,
      }}
      title={t('hide.coverHint')}
    >
      <EyeOff style={{ width: '2em', height: '2em' }} />
      <span className="font-medium">{t('hide.hidden')}</span>
      {mayShow && (
        <div className="flex flex-wrap items-center justify-center gap-[0.5em]">
          <Knob label={t('hide.show')} onClick={onShow}>
            <Eye style={{ width: '1.1em', height: '1.1em' }} />
            {t('hide.show')}
          </Knob>
          <Knob label={t('hide.peek')} onClick={() => onPeek(true)}>
            <ScanEye style={{ width: '1.1em', height: '1.1em' }} />
            {t('hide.peek')}
          </Knob>
        </div>
      )}
    </div>
  )
}
