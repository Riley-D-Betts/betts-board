import { z } from 'zod'

/**
 * THE locale registry. Adding a language means adding one entry here plus a
 * translated folder under `i18n/locales/<code>/` and a sibling `<code>.ts` —
 * the household setting's enum, the Nuxt i18n `locales` array, and the
 * settings picker all derive from this list, so they cannot drift apart.
 *
 * `language` is the BCP 47 tag handed to `Intl` and Luxon. It carries the
 * region deliberately: `es` alone leaves the date order and decimal separator
 * to the runtime's guess, and the guess differs between the Node server and
 * the browser — which is exactly how a hydration mismatch starts.
 *
 * `name` is written in the language itself. Somebody who has landed in a
 * language they can't read needs to find their own in the list.
 */
export interface LocaleDef {
  code: string
  language: string
  /** Endonym — "Español", not "Spanish". */
  name: string
  /** Filename under i18n/locales/. */
  file: string
}

export const LOCALE_DEFS: readonly LocaleDef[] = [
  { code: 'en', language: 'en-US', name: 'English', file: 'en.ts' },
  { code: 'es', language: 'es-ES', name: 'Español', file: 'es.ts' },
  { code: 'fr', language: 'fr-FR', name: 'Français', file: 'fr.ts' },
] as const

export const LOCALE_CODES = LOCALE_DEFS.map(l => l.code) as [string, ...string[]]

export const DEFAULT_LOCALE = 'en'

/** Rows created before the setting existed have no locale → English. */
export const zLocaleCode = z.enum(LOCALE_CODES)

export function localeDef(code: string | null | undefined): LocaleDef {
  return LOCALE_DEFS.find(l => l.code === code) ?? LOCALE_DEFS[0]!
}

/**
 * The BCP 47 tag for a stored code. Everything that formats a date, a number,
 * or an amount goes through this rather than using the bare code, so
 * `es` never reaches `Intl` as an under-specified tag.
 */
export function languageTag(code: string | null | undefined): string {
  return localeDef(code).language
}
