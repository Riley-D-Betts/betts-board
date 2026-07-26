import type { DateTime } from 'luxon'

/**
 * Formats a DateTime for a *machine* — an RFC 5545 RRULE, an iCal DTSTART, an
 * <input type="datetime-local"> value.
 *
 * Luxon's `toFormat` honours the ambient locale, so under a locale with a
 * non-Latin numbering system (ar-SA, fa-IR) it emits e.g. `٢٠٢٦٠٧٢٢` where a
 * parser expects `20260722`. That produces RRULEs and .ics files nothing can
 * read — silently, and only for some users. Pinning the locale, numbering
 * system, and calendar here makes these call sites immune no matter what any
 * future i18n work does globally.
 *
 * Display formatting is the opposite case and belongs in useDateFormat().
 */
export function machineFormat(dt: DateTime, format: string): string {
  return dt
    .reconfigure({ locale: 'en-US', numberingSystem: 'latn', outputCalendar: 'gregory' })
    .toFormat(format)
}
