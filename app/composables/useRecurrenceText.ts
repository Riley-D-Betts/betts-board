import { describeRecurrence } from '#shared/utils/recurrenceText'

/**
 * Turns an RRULE into a sentence in the board's language.
 *
 * The sentence structure lives in the locale file (`calendar.recurrence.*`),
 * not here — see shared/utils/recurrenceText.ts for why building it in code
 * cannot be translated.
 *
 * Weekday names come from Luxon's calendar data rather than the locale file:
 * every language already knows what Wednesday is called, and asking a
 * translator to retype seven day names is seven chances to disagree with the
 * day names the calendar grid is already showing.
 */
export function useRecurrenceText() {
  const { t } = useI18n()
  const { weekdayNames, formatDayMonthYear } = useDateFormat()

  const INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

  function recurrenceText(rrule: string | null | undefined): string {
    const d = describeRecurrence(rrule)
    if (d.raw) return d.raw

    const names = weekdayNames('short')
    const params: Record<string, string | number> = { ...d.params }
    if (d.weekdays) {
      // Joined with the locale's list separator would be better still, but
      // Intl.ListFormat is not available in every runtime this ships to.
      params.days = d.weekdays.map(code => names[INDEX[code] ?? 0] ?? code).join(', ')
    }

    const base = t(`calendar.recurrence.${d.key}`, params, Number(params.n ?? 1))
    if (!d.suffix) return base

    // describeRecurrence hands UNTIL over as a bare YYYY-MM-DD calendar string
    // and leaves the formatting here on purpose — it is a pure module with no
    // locale. Formatting it is this function's job, and skipping it renders
    // "Cada semana hasta el 2026-12-31" at somebody.
    const suffixParams: Record<string, string | number> = { base, ...d.suffix.params }
    if (typeof suffixParams.date === 'string') {
      suffixParams.date = formatDayMonthYear(suffixParams.date)
    }

    return t(
      `calendar.recurrence.${d.suffix.key}`,
      suffixParams,
      Number(d.suffix.params.n ?? 1),
    )
  }

  return { recurrenceText }
}
