/**
 * German and English, as in nexlore. Custom languages (uploaded JSON laid over English) follow with the server.
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import de from './de.json'
import en from './en.json'

export const LANGUAGES = {
  de: { label: 'DE', name: 'Deutsch' },
  en: { label: 'EN', name: 'English' },
} as const

export type Language = keyof typeof LANGUAGES

const KEY = 'nexcanvas.language'

function first(): Language {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'de' || stored === 'en') return stored
  } catch {
    // private mode
  }
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en'
}

i18n.use(initReactI18next).init({
  resources: { de: { translation: de }, en: { translation: en } },
  lng: first(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})
document.documentElement.lang = i18n.language

export function setLanguage(code: Language): void {
  void i18n.changeLanguage(code)
  document.documentElement.lang = code
  try {
    localStorage.setItem(KEY, code)
  } catch {
    // private mode
  }
}

export default i18n
