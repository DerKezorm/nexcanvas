import { Bell, BellOff, Pause, Play, RotateCcw } from 'lucide-react'
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ItemActions } from './PdfPage'

import { serverNow } from '../clock'
import { clockText, nudge, parseDuration, pause, remaining, reset, ring, start, stateOf } from '../timer'
import type { TimerItem } from '../types'

/** Redraws while the timer runs, a few times a second, so the seconds turn over on time. */
function useTicking(running: boolean): number {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    setNow(serverNow())
    if (!running) return
    const timer = window.setInterval(() => setNow(serverNow()), 200)
    return () => window.clearInterval(timer)
  }, [running])
  return running ? now : serverNow()
}

function Knob({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="grid aspect-square h-full place-items-center rounded-lg text-mist-300 hover:bg-ink-700 hover:text-mist-100"
    >
      {children}
    </button>
  )
}

/**
 * A timer as a card on the board: its name, the time, and for who may write the buttons to start, pause, reset and
 * give or take a minute. Everybody sees it run alike, because the moment it ends is written on the server's clock.
 */
export function TimerCard({ item, editing, onDone }: { item: TimerItem; editing: boolean; onDone: () => void }) {
  const { t } = useTranslation()
  const { patch, readOnly } = useContext(ItemActions)
  const ticking = item.ends !== undefined
  const now = useTicking(ticking)
  const state = stateOf(item, now)
  const left = remaining(item, now)
  const unit = Math.min(item.w / 240, item.h / 150)

  // It rings where it was seen running out, not where a board is opened on a timer that ran out long ago.
  const before = useRef(state)
  useEffect(() => {
    if (before.current === 'running' && state === 'done' && item.sound !== false) ring()
    before.current = state
  }, [state, item.sound])

  const change = (fn: (at: number) => Partial<TimerItem>) => patch(item.id, fn(serverNow()))
  const share = item.duration > 0 ? 1 - left / (item.duration * 1000) : 0

  return (
    <div
      className={'flex h-full w-full flex-col overflow-hidden rounded-xl border bg-ink-850 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)] ' + (state === 'done' ? 'border-accent-500' : 'border-ink-600')}
      data-timer-state={state}
    >
      {editing ? (
        <TimerForm item={item} onDone={onDone} unit={unit} />
      ) : (
        <>
          <div className="truncate px-[6%] pt-[4%] font-medium text-mist-400" style={{ fontSize: 13 * unit }}>
            {item.title || t('timer.untitled')}
          </div>
          <div
            className={'flex flex-1 items-center justify-center font-semibold tabular-nums ' + (state === 'done' ? 'animate-pulse text-accent-400' : 'text-mist-100')}
            style={{ fontSize: 46 * unit, lineHeight: 1 }}
            role="timer"
            aria-live="off"
          >
            {clockText(left)}
          </div>
          {!readOnly && (
            <div className="flex items-center justify-center gap-[2%] px-[4%]" style={{ height: 30 * unit, marginBottom: 8 * unit }}>
              <Knob label={t('timer.less')} onClick={() => change((at) => nudge(item, at, -60))}>
                <span className="font-semibold" style={{ fontSize: 12 * unit }}>−1</span>
              </Knob>
              {state === 'running' ? (
                <Knob label={t('timer.pause')} onClick={() => change((at) => pause(item, at))}>
                  <Pause style={{ width: 16 * unit, height: 16 * unit }} />
                </Knob>
              ) : (
                <Knob label={state === 'paused' ? t('timer.resume') : t('timer.start')} onClick={() => change((at) => start(item, at))}>
                  <Play style={{ width: 16 * unit, height: 16 * unit }} />
                </Knob>
              )}
              <Knob label={t('timer.reset')} onClick={() => change(() => reset())}>
                <RotateCcw style={{ width: 15 * unit, height: 15 * unit }} />
              </Knob>
              <Knob label={t('timer.more')} onClick={() => change((at) => nudge(item, at, 60))}>
                <span className="font-semibold" style={{ fontSize: 12 * unit }}>+1</span>
              </Knob>
              <Knob label={item.sound === false ? t('timer.soundOn') : t('timer.soundOff')} onClick={() => patch(item.id, { sound: item.sound === false })}>
                {item.sound === false ? <BellOff style={{ width: 15 * unit, height: 15 * unit }} /> : <Bell style={{ width: 15 * unit, height: 15 * unit }} />}
              </Knob>
            </div>
          )}
          <div className="h-[3%] min-h-[2px] bg-ink-800">
            <div className="h-full bg-accent-500 transition-[width] duration-200" style={{ width: `${Math.round(Math.min(1, Math.max(0, state === 'set' ? 0 : share)) * 1000) / 10}%` }} />
          </div>
        </>
      )}
    </div>
  )
}

/** Name and duration, opened with a double click. Enter or leaving the fields keeps them, Escape drops them. */
function TimerForm({ item, onDone, unit }: { item: TimerItem; onDone: () => void; unit: number }) {
  const { t } = useTranslation()
  const { patch } = useContext(ItemActions)
  const [title, setTitle] = useState(item.title)
  const [length, setLength] = useState(clockText(item.duration * 1000))
  const box = useRef<HTMLFormElement>(null)
  const seconds = parseDuration(length)

  const keep = () => {
    const change: Partial<TimerItem> = {}
    const name = title.trim().slice(0, 120)
    if (name !== item.title) change.title = name
    // A new duration sets the timer back, so it starts from there.
    if (seconds !== null && seconds !== item.duration) Object.assign(change, { duration: seconds, ...reset() })
    if (Object.keys(change).length) patch(item.id, change)
    onDone()
  }

  return (
    <form
      ref={box}
      className="flex h-full flex-col justify-center gap-[6%] p-[6%]"
      style={{ fontSize: 13 * unit }}
      onPointerDown={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault()
        keep()
      }}
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) keep()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onDone()
      }}
    >
      <label className="flex flex-col gap-1 text-mist-500">
        {t('timer.name')}
        <input
          autoFocus
          value={title}
          maxLength={120}
          placeholder={t('timer.untitled')}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={(e) => e.target.select()}
          className="rounded-md border border-ink-600 bg-ink-950 px-2 py-1 text-mist-100 outline-none focus:border-accent-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-mist-500">
        {t('timer.duration')}
        <input
          value={length}
          onChange={(e) => setLength(e.target.value)}
          onFocus={(e) => e.target.select()}
          aria-invalid={seconds === null}
          className={'rounded-md border bg-ink-950 px-2 py-1 font-semibold text-mist-100 tabular-nums outline-none ' + (seconds === null ? 'border-bad-500' : 'border-ink-600 focus:border-accent-500')}
        />
      </label>
      <button type="submit" className="sr-only">
        {t('timer.keep')}
      </button>
    </form>
  )
}
