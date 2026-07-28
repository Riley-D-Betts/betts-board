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

  /** "Jul 23, 2026" — for anything old enough that the year matters. */
  function formatDayMonthYear(date: Date | string): string {
    return withLocale(toDateTime(date))
      .toLocaleString({ month: 'short', day: 'numeric', year: 'numeric' })
  }

  /** "Thu, Jul 23, 2026" — the day-view heading. */
  function formatWeekdayDateYear(date: Date | string): string {
    return withLocale(toDateTime(date))
      .toLocaleString({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  }

  /**
   * "Thu, Jul 23, 7:30 AM" — one instant, spelled out.
   *
   * Takes a zone for the same reason formatTime does: an event belongs to the
   * household's timezone, and rendering it in the device's would show a
   * travelling parent the wrong time for their own calendar.
   */
  function formatDateTime(ms: number, zone?: string): string {
    return withLocale(DateTime.fromMillis(ms, zone ? { zone } : undefined))
      .toLocaleString({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  /**
   * "6 AM" / "06" — the hour gutter down the side of the week grid.
   *
   * Locale-driven rather than a hardcoded 12-hour format: half the world reads
   * 18:00, and a column of "6 PM" labels is the kind of thing that makes a
   * translated app still feel foreign.
   */
  function formatHour(hour: number): string {
    return withLocale(DateTime.fromObject({ hour }))
      .toLocaleString({ hour: 'numeric' })
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
    formatDayMonthYear,
    formatWeekdayDateYear,
    formatDateTime,
    formatHour,
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
