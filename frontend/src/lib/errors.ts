import { ApiError } from '../api/client'
import i18n from '../i18n'

/** The sentence for a server's error code, in the language of the page; an unknown code gets the general one. */
export function errorText(code: string, values: Record<string, unknown> = {}): string {
  const key = `errors.${code}`
  return i18n.exists(key) ? i18n.t(key, values) : i18n.t('errors.internal_error')
}

/** The sentence for whatever went wrong, with the values the server sent along ("at most {{maximum}} characters"). */
export function problemText(error: unknown): string {
  return error instanceof ApiError ? errorText(error.code, error.values) : errorText('internal_error')
}
