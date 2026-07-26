import ical from 'ical-generator'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { machineFormat } from '#shared/utils/machineFormat'
import type { Db } from '../../db/client'
import { eventExceptions, events, type households } from '../../db/schema'
import { decodeDateKey } from '../calendar/expand'

type Household = typeof households.$inferSelect
type EventRow = typeof events.$inferSelect
type ExceptionRow = typeof eventExceptions.$inferSelect

function compactDate(dateString: string): string {
  return dateString.replace(/-/g, '')
}

/** RRULE (+ EXDATE for every touched occurrence) as verbatim ICS lines. */
function repeatingLines(ev: EventRow, exceptions: ExceptionRow[]): string {
  const lines = [`RRULE:${ev.rrule}`]
  const touched = exceptions.map(x => x.occurrenceStart.getTime()).sort((a, b) => a - b)
  if (touched.length) {
    if (ev.isAllDay) {
      lines.push(`EXDATE;VALUE=DATE:${touched.map(ms => compactDate(decodeDateKey(ms))).join(',')}`)
    }
    else {
      const stamps = touched.map(ms =>
        machineFormat(DateTime.fromMillis(ms, { zone: ev.timezone }), 'yyyyMMdd\'T\'HHmmss'))
      lines.push(`EXDATE;TZID=${ev.timezone}:${stamps.join(',')}`)
    }
  }
  return lines.join('\n')
}

/**
 * Build the household's export calendar from LOCAL events only (feedId null) —
 * re-exporting imported feeds would loop them back into their source apps.
 */
export function buildHouseholdIcs(db: Db, household: Household): string {
  const cal = ical({ name: household.name, prodId: '//betts-board//EN' })

  const local = db.select().from(events).where(and(
    eq(events.householdId, household.id),
    isNull(events.feedId),
  )).all()

  const exceptionRows = local.length
    ? db.select().from(eventExceptions)
        .where(inArray(eventExceptions.eventId, local.map(e => e.id))).all()
    : []
  const exceptionsByEvent = new Map<string, ExceptionRow[]>()
  for (const ex of exceptionRows) {
    const list = exceptionsByEvent.get(ex.eventId) ?? []
    list.push(ex)
    exceptionsByEvent.set(ex.eventId, list)
  }

  for (const ev of local) {
    const exceptions = ev.rrule ? (exceptionsByEvent.get(ev.id) ?? []) : []

    if (ev.isAllDay) {
      cal.createEvent({
        id: ev.id,
        allDay: true,
        // Date strings pass through untouched (no timezone set → UTC getters
        // on the parsed UTC-midnight date). endDate is already DTEND-exclusive.
        start: ev.startDate!,
        end: ev.endDate!,
        summary: ev.title,
        description: ev.description,
        location: ev.location,
        repeating: ev.rrule ? repeatingLines(ev, exceptions) : null,
      })
    }
    else {
      cal.createEvent({
        id: ev.id,
        timezone: ev.timezone,
        // Luxon values let ical-generator render wall time in the event's zone.
        start: DateTime.fromJSDate(ev.startAt!),
        end: DateTime.fromJSDate(ev.endAt!),
        summary: ev.title,
        description: ev.description,
        location: ev.location,
        repeating: ev.rrule ? repeatingLines(ev, exceptions) : null,
      })
    }

    // Simplification: modified occurrences are exported as standalone one-off
    // VEVENTs while their original instants are EXDATEd from the master above,
    // instead of proper RECURRENCE-ID overrides. Calendar apps render the same
    // result; only the linkage to the parent series is lost.
    const durationMs = ev.isAllDay ? 0 : ev.endAt!.getTime() - ev.startAt!.getTime()
    for (const ex of exceptions.filter(x => x.kind === 'modified')) {
      const uid = `${ev.id}-${ex.occurrenceStart.getTime()}`
      if (ev.isAllDay) {
        const date = decodeDateKey(ex.occurrenceStart.getTime())
        cal.createEvent({
          id: uid,
          allDay: true,
          start: date,
          end: decodeDateKey(ex.occurrenceStart.getTime() + 86_400_000),
          summary: ex.newTitle ?? ev.title,
          description: ex.newDescription ?? ev.description,
          location: ex.newLocation ?? ev.location,
        })
      }
      else {
        const startMs = ex.newStartAt?.getTime() ?? ex.occurrenceStart.getTime()
        const endMs = ex.newEndAt?.getTime() ?? startMs + durationMs
        cal.createEvent({
          id: uid,
          timezone: ev.timezone,
          start: DateTime.fromMillis(startMs),
          end: DateTime.fromMillis(endMs),
          summary: ex.newTitle ?? ev.title,
          description: ex.newDescription ?? ev.description,
          location: ex.newLocation ?? ev.location,
        })
      }
    }
  }

  return cal.toString()
}
