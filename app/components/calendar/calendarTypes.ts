import type { CalendarOccurrence } from '#shared/schemas/events'

/** GET /api/events/:id result (Dates arrive as ISO strings over HTTP). */
export interface EventMaster {
  id: string
  title: string
  description: string | null
  location: string | null
  isAllDay: boolean
  startAt: string | number | null
  endAt: string | number | null
  startDate: string | null
  endDate: string | null
  timezone: string
  rrule: string | null
  reminderMinutes: number[] | null
  color: string | null
  feedId: string | null
  attendeeProfileIds: string[]
  exceptionsCount: number
  feedName: string | null
}

/** Payload the calendar page hands to EventEditor when editing. */
export interface EditPayload {
  scope: 'all' | 'this' | 'future'
  occurrence: CalendarOccurrence
  /** ORIGINAL occurrence instant (ms) parsed from occurrenceId. */
  occurrenceStart: number
  master: EventMaster
}
