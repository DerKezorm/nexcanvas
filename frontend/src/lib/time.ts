/** "5 minutes ago", "yesterday" in the language of the app. */
export function ago(time: number, lang: string): string {
  const seconds = Math.round((time - Date.now()) / 1000)
  const format = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const abs = Math.abs(seconds)
  if (abs < 60) return format.format(0, 'minute')
  if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return format.format(Math.round(seconds / 3600), 'hour')
  if (abs < 86400 * 30) return format.format(Math.round(seconds / 86400), 'day')
  return new Date(time).toLocaleDateString(lang)
}

/** A moment as the family writes it everywhere: the day as the lists show days (4.10.2026), with hours and minutes, no
 * seconds (Prüfgang G11, as nexsuite and nexbrand). The log adds seconds. */
export function moment(value: string | number | Date, lang: string, seconds = false): string {
  return new Date(value).toLocaleString(lang, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  })
}

/** Only the time of day, as hours and minutes ("22:35"). */
export function clock(value: string | number | Date, lang: string): string {
  return new Date(value).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
}
