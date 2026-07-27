import { DateTime, Info } from 'luxon'
import { languageTag } from '#shared/schemas/locales'

/**
 * Locale-aware date and time formatting for *display*.
 *
 * Replaces a scatter of hardcoded Luxon patterns — `'h:mm a'` alone appeared
 * at seven call sites — which baked in a 12-hour clock and English day names.
 *
 * ⚠️ Display only. Four places in the codebase format dates for *machines*:
 * the `datetime-local` input value in EventEditor, the RRULE `UNTIL` and date
 * key in services/calendar/recurrence.ts, and the iCal `DTSTART` in
 * services/ics/export.ts. Those must keep using explicit `toFormat()` with no
 * locale — under a locale with a non-Latin numbering system (ar-SA, fa-IR)
 * Luxon would emit Arabic-Indic digits and produce corrupt RRULEs and
 * unparseable .ics files. For the same reason we never set a global
 * Settings.defaultLocale; the locale is applied here and only here.
 *
 * The YYYY-MM-DD helpers in shared/utils/dates.ts must likewise never pass
 * through a locale formatter — they are calendar keys, not text.
 */
export function useDateFormat() {
  const { locale } = useI18n()
  // The BCP 47 tag, not the bare code. `es` leaves the date order and the
  // decimal separator to the runtime's guess, and Node and the browser do not
  // always guess the same — a hydration mismatch that only shows up for
  // non-English households.
  const tag = computed(() => languageTag(locale.value))

  const withLocale = (dt: DateTime) => dt.setLocale(tag.value)

  /** "7:30 AM" / "07:30" — follows the locale's clock convention. */
  function formatTime(ms: number, zone?: string): string {
    return withLocale(DateTime.fromMillis(ms, zone ? { zone } : undefined))
      .toLocaleString(DateTime.TIME_SIMPLE)
  }

  /** "Jul 23" */
  function formatDayMonth(date: Date | string): string {
    return withLocale(toDateTime(date)).toLocaleString({ month: 'short', day: 'numeric' })
  }

  /** "Thursday" */
  function formatWeekdayLong(date: Date | string): string {
    return withLocale(toDateTime(date)).toLocaleString({ weekday: 'long' })
  }

  /** "Thu" */
  function formatWeekdayShort(date: Date | string): string {
    return withLocale(toDateTime(date)).toLocaleString({ weekday: 'short' })
  }

  /** "Thursday, Jul 23" */
  function formatWeekdayDate(date: Date | string): string {
    return withLocale(toDateTime(date))
      .toLocaleString({ weekday: 'long', month: 'short', day: 'numeric' })
  }

  /** "July 2026" */
  function formatMonthYear(date: Date | string): string {
    return withLocale(toDateTime(date)).toLocaleString({ month: 'long', year: 'numeric' })
  }

  /**
   * "3 minutes ago" / "yesterday". Luxon's toRelative, which delegates to
   * Intl.RelativeTimeFormat — so it stays display-only like everything else
   * here. Falls back to an absolute date if Luxon declines to produce one.
   */
  function formatRelative(ms: number): string {
    const dt = withLocale(DateTime.fromMillis(ms))
    return dt.toRelative() ?? dt.toLocaleString(DateTime.DATETIME_MED)
  }

  /** Localised weekday names, Sunday first — replaces hardcoded arrays. */
  function weekdayNames(format: 'short' | 'long' = 'short'): string[] {
    // Luxon returns Monday-first; rotate so index 0 is Sunday, matching the
    // app's weekStartsOn convention and Date#getDay().
    const names = Info.weekdays(format, { locale: tag.value })
    return [names[6]!, ...names.slice(0, 6)]
  }

  return {
    formatTime,
    formatDayMonth,
    formatWeekdayLong,
    formatWeekdayShort,
    formatWeekdayDate,
    formatMonthYear,
    formatRelative,
    weekdayNames,
  }
}

/** Accepts a Date or a YYYY-MM-DD calendar string (parsed as a local date). */
function toDateTime(value: Date | string): DateTime {
  return typeof value === 'string'
    ? DateTime.fromISO(value)
    : DateTime.fromJSDate(value)
}
