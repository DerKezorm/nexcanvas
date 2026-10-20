/**
 * The server's clock, so a timer on a board runs out at the same moment for everybody: the offset between this
 * device and the server, learned once and refined by the fastest answer.
 */

let offset = 0
let best = Number.POSITIVE_INFINITY
let asked: Promise<void> | null = null

/** Now, in milliseconds, as the server counts. */
export function serverNow(): number {
  return Date.now() + offset
}

async function askOnce(): Promise<void> {
  const sent = Date.now()
  const response = await fetch('/api/health/clock', { cache: 'no-store' })
  const back = Date.now()
  if (!response.ok) return
  const { now } = (await response.json()) as { now: number }
  const trip = back - sent
  // The answer was written about halfway; the shortest trip guesses that best.
  if (typeof now === 'number' && trip < best) {
    best = trip
    offset = now - (sent + trip / 2)
  }
}

/** Learns the offset (three answers, the fastest counts). Asking again does nothing. */
export function learnServerClock(): Promise<void> {
  asked ??= (async () => {
    for (let i = 0; i < 3; i++) await askOnce().catch(() => undefined)
  })()
  return asked
}

/** Forgets what was learned (for tests). */
export function forgetServerClock(): void {
  offset = 0
  best = Number.POSITIVE_INFINITY
  asked = null
}
