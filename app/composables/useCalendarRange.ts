import { DateTime } from 'luxon'

export type CalendarView = 'month' | 'week' | 'day' | 'agenda'

export const AGENDA_DAYS = 30

/** First day of the week containing `dt`, honoring weekStartsOn (0=Sun, 1=Mon). */
export function startOfWeekDt(dt: DateTime, weekStartsOn: 0 | 1): DateTime {
  const dow = dt.weekday % 7 // 0=Sun … 6=Sat
  const diff = (dow - weekStartsOn + 7) % 7
  return dt.minus({ days: diff }).startOf('day')
}

/**
 * Computed [startMs, endMs) fetch window for a view + anchor date in the
 * HOUSEHOLD timezone, plus prev/today/next movers that shift the anchor.
 *
 * - month: the full visible 6x7 grid (grid start … +42 days)
 * - week: start of the anchor's week … +7 days
 * - day: the anchor day
 * - agenda: the anchor day … +30 days
 */
export function useCalendarRange(opts: {
  view: Ref<CalendarView>
  anchor: Ref<string> // YYYY-MM-DD in household wall time
  timezone: Ref<string>
  weekStartsOn: Ref<0 | 1>
}) {
  const { view, anchor, timezone, weekStartsOn } = opts

  const anchorDt = computed(() =>
    DateTime.fromISO(anchor.value, { zone: timezone.value }).startOf('day'))

  const range = computed(() => {
    const dt = anchorDt.value
    let start: DateTime
    let end: DateTime
    switch (view.value) {
      case 'month': {
        start = startOfWeekDt(dt.startOf('month'), weekStartsOn.value)
        end = start.plus({ days: 42 })
        break
      }
      case 'week': {
        start = startOfWeekDt(dt, weekStartsOn.value)
        end = start.plus({ days: 7 })
        break
      }
      case 'day': {
        start = dt
        end = start.plus({ days: 1 })
        break
      }
      default: { // agenda
        start = dt
        end = start.plus({ days: AGENDA_DAYS })
      }
    }
    return {
      startMs: start.toMillis(),
      endMs: end.toMillis(),
      startDate: start.toISODate()!,
      /** Exclusive end date of the window. */
      endDateExcl: end.toISODate()!,
    }
  })

  const title = computed(() => {
    const dt = anchorDt.value
    switch (view.value) {
      case 'month':
        return dt.toFormat('LLLL yyyy')
      case 'week': {
        const start = startOfWeekDt(dt, weekStartsOn.value)
        const end = start.plus({ days: 6 })
        return start.month === end.month
          ? `${start.toFormat('LLL d')} – ${end.toFormat('d, yyyy')}`
          : `${start.toFormat('LLL d')} – ${end.toFormat('LLL d, yyyy')}`
      }
      case 'day':
        return dt.toFormat('ccc, LLL d, yyyy')
      default:
        return `Next ${AGENDA_DAYS} days`
    }
  })

  function move(direction: 1 | -1) {
    const dt = anchorDt.value
    switch (view.value) {
      case 'month':
        anchor.value = dt.startOf('month').plus({ months: direction }).toISODate()!
        break
      case 'week':
        anchor.value = dt.plus({ weeks: direction }).toISODate()!
        break
      case 'day':
        anchor.value = dt.plus({ days: direction }).toISODate()!
        break
      default:
        anchor.value = dt.plus({ days: direction * AGENDA_DAYS }).toISODate()!
    }
  }

  const prev = () => move(-1)
  const next = () => move(1)
  const today = () => {
    anchor.value = DateTime.now().setZone(timezone.value).toISODate()!
  }

  return { range, title, prev, next, today }
}
