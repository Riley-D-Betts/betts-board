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
  const { weekdayNames } = useDateFormat()

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

    return t(
      `calendar.recurrence.${d.suffix.key}`,
      { base, ...d.suffix.params },
      Number(d.suffix.params.n ?? 1),
    )
  }

  return { recurrenceText }
}
