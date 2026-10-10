import { ApiError } from '../api/client'
import i18n from '../i18n'
import { oidcErrorKey } from '../vendor/nexoidc/oidc'

/** The sentence for a server's error code, in the language of the page; an unknown code gets the general one. */
export function errorText(code: string, values: Record<string, unknown> = {}): string {
  const key = `errors.${code}`
  if (i18n.exists(key)) return i18n.t(key, values)
  // The fixed codes of sign-in through a provider bring their sentences with the shared module (`oidc.error.*`).
  const signIn = oidcErrorKey(code)
  return signIn ? i18n.t(signIn) : i18n.t('errors.internal_error')
}

/** What a way back from a provider says in the address (`?error=`): a fixed sign-in code in the shared module's
 * words (Bauplan 04), one of nexcanvas' own as such; never the raw code. */
export function signInErrorText(code: string): string {
  const signIn = oidcErrorKey(code)
  return signIn ? i18n.t(signIn) : errorText(code)
}

/** The sentence for whatever went wrong, with the values the server sent along ("at most {{maximum}} characters"). */
export function problemText(error: unknown): string {
  return error instanceof ApiError ? errorText(error.code, error.values) : errorText('internal_error')
}
