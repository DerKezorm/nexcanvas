import { clockText, nudge, parseDuration, pause, remaining, reset, start, stateOf } from './timer'
import type { TimerItem } from './types'

const timer = (more: Partial<TimerItem> = {}): TimerItem => ({ id: 'timer1', kind: 'timer', x: 0, y: 0, w: 240, h: 150, title: '', duration: 300, ...more })

describe('a timer', () => {
  it('shows its duration until it is started', () => {
    expect(stateOf(timer(), 1000)).toBe('set')
    expect(clockText(remaining(timer(), 1000))).toBe('5:00')
  })

  it('counts down from the moment it ends, on the server clock', () => {
    const running = { ...timer(), ...start(timer(), 10_000) }
    expect(running.ends).toBe(310_000)
    expect(stateOf(running, 250_000)).toBe('running')
    expect(clockText(remaining(running, 250_000))).toBe('1:00')
    expect(clockText(remaining(running, 309_001))).toBe('0:01')
    expect(stateOf(running, 310_000)).toBe('done')
    expect(clockText(remaining(running, 400_000))).toBe('0:00')
  })

  it('keeps what is left over a pause and goes on from there', () => {
    const running = { ...timer(), ...start(timer(), 0) }
    const paused = { ...running, ...pause(running, 100_000) }
    expect(stateOf(paused, 999_999)).toBe('paused')
    expect(remaining(paused, 999_999)).toBe(200_000)
    const again = { ...paused, ...start(paused, 500_000) }
    expect(again.ends).toBe(700_000)
    expect(again.left).toBeUndefined()
  })

  it('starts from the top again once it ran out, and a reset sets it back', () => {
    const done = timer({ ends: 5 })
    expect(start(done, 1000).ends).toBe(301_000)
    expect(stateOf({ ...done, ...reset() }, 1000)).toBe('set')
  })

  it('takes a minute more or less: the duration while set, the time left while running', () => {
    expect(nudge(timer(), 0, 60)).toEqual({ duration: 360 })
    expect(nudge(timer({ duration: 30 }), 0, -60)).toEqual({ duration: 10 })
    expect(nudge(timer({ ends: 100_000 }), 40_000, 60)).toEqual({ ends: 160_000 })
    expect(nudge(timer({ ends: 100_000 }), 40_000, -120)).toEqual({ ends: 41_000 })
    expect(nudge(timer({ left: 30_000 }), 0, 60)).toEqual({ left: 90_000 })
  })

  it('reads durations as people type them', () => {
    expect(parseDuration('5')).toBe(300)
    expect(parseDuration('4:30')).toBe(270)
    expect(parseDuration('1:00:00')).toBe(3600)
    expect(parseDuration('90s')).toBe(90)
    expect(parseDuration('1,5 min')).toBe(90)
    expect(parseDuration('2h')).toBe(7200)
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('abc')).toBeNull()
    expect(parseDuration('5s')).toBeNull()
    expect(parseDuration('11h')).toBeNull()
  })

  it('writes hours when there are any', () => {
    expect(clockText(3_723_000)).toBe('1:02:03')
    expect(clockText(59_500)).toBe('1:00')
  })
})
