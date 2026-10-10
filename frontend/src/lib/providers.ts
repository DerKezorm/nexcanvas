/** The way to a sign-in provider (the shared sign-in module's start route, `vendor/nexoidc`). */

/** Where a provider's button leads: its start, with the invitation or the page a direct link asked for. */
export function startAddress(slug: string, { invite, next }: { invite?: string; next?: string } = {}): string {
  const start = `/api/oidc/${encodeURIComponent(slug)}/start`
  if (invite) return `${start}?invite=${encodeURIComponent(invite)}`
  return next && next !== '/' ? `${start}?next=${encodeURIComponent(next)}` : start
}

/** Off to the provider (a full page load: the way back comes to the server, not to this page). */
export function go(url: string): void {
  window.location.assign(url)
}
