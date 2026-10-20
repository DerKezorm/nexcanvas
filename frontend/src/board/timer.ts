/** What a timer shows and what its buttons change, apart from how it looks. */

import type { TimerItem } from './types'

export const TIMER_SIZE = { w: 300, h: 190 }
/** Ten seconds to ten hours. */
export const TIMER_MIN = 10
export const TIMER_MAX = 10 * 3600

export type TimerState = 'set' | 'running' | 'paused' | 'done'

export function stateOf(timer: TimerItem, now: number): TimerState {
  if (timer.ends !== undefined) return now >= timer.ends ? 'done' : 'running'
  if (timer.left !== undefined) return 'paused'
  return 'set'
}

/** Milliseconds still to go. */
export function remaining(timer: TimerItem, now: number): number {
  if (timer.ends !== undefined) return Math.max(0, timer.ends - now)
  if (timer.left !== undefined) return Math.max(0, timer.left)
  return timer.duration * 1000
}

/** 4:05, 12:00, 1:02:03. A second that has begun counts, so it shows 0:00 only when time is up. */
export function clockText(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/** Reads what someone typed as a duration: 5 (minutes), 4:30, 1:00:00, 90s, 2m, 1h. Null when it is none. */
export function parseDuration(text: string): number | null {
  const value = text.trim().toLowerCase().replace(',', '.')
  let seconds: number
  const unit = value.match(/^(\d+(?:\.\d+)?)\s*(s|sec|sek|m|min|h|std)?$/)
  if (unit) {
    const n = Number(unit[1])
    const u = unit[2] ?? 'm'
    seconds = u.startsWith('s') && u !== 'std' ? n : u.startsWith('h') || u === 'std' ? n * 3600 : n * 60
  } else if (/^\d+(:\d{1,2}){1,2}$/.test(value)) {
    seconds = value.split(':').map(Number).reduce((sum, part) => sum * 60 + part, 0)
  } else return null
  seconds = Math.round(seconds)
  if (!Number.isFinite(seconds) || seconds < TIMER_MIN || seconds > TIMER_MAX) return null
  return seconds
}

/** Start, or go on after a pause. A timer that ran out starts again from the top. */
export function start(timer: TimerItem, now: number): Partial<TimerItem> {
  const state = stateOf(timer, now)
  const left = state === 'paused' ? remaining(timer, now) : timer.duration * 1000
  return { ends: now + left, left: undefined }
}

export function pause(timer: TimerItem, now: number): Partial<TimerItem> {
  return { ends: undefined, left: remaining(timer, now) }
}

export function reset(): Partial<TimerItem> {
  return { ends: undefined, left: undefined }
}

/** A minute more or less: while set it changes the duration, while running or paused the time left. */
export function nudge(timer: TimerItem, now: number, seconds: number): Partial<TimerItem> {
  const state = stateOf(timer, now)
  if (state === 'set' || state === 'done') {
    const duration = Math.min(TIMER_MAX, Math.max(TIMER_MIN, timer.duration + seconds))
    return state === 'done' ? { duration, ends: undefined, left: undefined } : { duration }
  }
  const left = Math.min(TIMER_MAX * 1000, Math.max(1000, remaining(timer, now) + seconds * 1000))
  return state === 'running' ? { ends: now + left } : { left }
}

/** Three short tones, made on the spot (no sound file). */
export function ring(): void {
  try {
    const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Audio) return
    const audio = new Audio()
    for (let i = 0; i < 3; i++) {
      const at = audio.currentTime + i * 0.32
      const tone = audio.createOscillator()
      const level = audio.createGain()
      tone.frequency.value = 880
      level.gain.setValueAtTime(0.0001, at)
      level.gain.exponentialRampToValueAtTime(0.25, at + 0.02)
      level.gain.exponentialRampToValueAtTime(0.0001, at + 0.22)
      tone.connect(level).connect(audio.destination)
      tone.start(at)
      tone.stop(at + 0.25)
    }
    window.setTimeout(() => void audio.close().catch(() => undefined), 1500)
  } catch {
    // No sound where the browser allows none; the timer still shows that it ran out.
  }
}
