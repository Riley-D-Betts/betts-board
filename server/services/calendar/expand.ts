import { and, eq, inArray, isNull, isNotNull, lt, or, gt } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { CalendarOccurrence } from '#shared/schemas/events'
import type { Db } from '../../db/client'
import { calendarFeeds, eventAttendees, eventExceptions, events, profiles } from '../../db/schema'
import { expandDateRule, expandTimedRule } from './recurrence'

/**
 * All-day occurrences are keyed in event_exceptions.occurrenceStart by the
 * UTC-midnight encoding of their date string (a reversible encoding, not a
 * real instant — all-day dates never pass through timezone conversion).
 */
export function encodeDateKey(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!)
}

export function decodeDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export interface ExpandEventsArgs {
  householdId: string
  windowStartMs: number
  windowEndMs: number
  /** Household timezone: defines which calendar dates the window covers for
   * all-day events and anchors their DTO instants. */
  timezone: string
  profileIds?: string[]
}

type ExceptionRow = typeof eventExceptions.$inferSelect

export function expandEvents(db: Db, args: ExpandEventsArgs): CalendarOccurrence[] {
  const { householdId, windowStartMs, windowEndMs, timezone } = args

  // The window's date range in household wall time (endDateExcl exclusive).
  const windowStartDate = DateTime.fromMillis(windowStartMs, { zone: timezone }).toISODate()!
  const windowEndDateExcl = DateTime.fromMillis(windowEndMs - 1, { zone: timezone })
    .plus({ days: 1 }).toISODate()!

  const candidates = db.select().from(events).where(and(
    eq(events.householdId, householdId),
    or(
      // one-off timed, overlapping the window
      and(
        isNull(events.rrule),
        eq(events.isAllDay, false),
        lt(events.startAt, new Date(windowEndMs)),
        gt(events.endAt, new Date(windowStartMs)),
      ),
      // one-off all-day, overlapping the window's date range
      and(
        isNull(events.rrule),
        eq(events.isAllDay, true),
        lt(events.startDate, windowEndDateExcl),
        gt(events.endDate, windowStartDate),
      ),
      // recurring, series not over before the window starts
      and(
        isNotNull(events.rrule),
        or(
          and(eq(events.isAllDay, false), lt(events.startAt, new Date(windowEndMs))),
          and(eq(events.isAllDay, true), lt(events.startDate, windowEndDateExcl)),
        ),
        or(isNull(events.recurrenceEnd), gt(events.recurrenceEnd, new Date(windowStartMs))),
      ),
    ),
  )).all()

  if (candidates.length === 0) return []
  const ids = candidates.map(e => e.id)

  const exceptionRows = db.select().from(eventExceptions)
    .where(inArray(eventExceptions.eventId, ids)).all()
  const exceptionsByEvent = new Map<string, Map<number, ExceptionRow>>()
  for (const ex of exceptionRows) {
    let m = exceptionsByEvent.get(ex.eventId)
    if (!m) exceptionsByEvent.set(ex.eventId, m = new Map())
    m.set(ex.occurrenceStart.getTime(), ex)
  }

  const attendeeRows = db.select({
    eventId: eventAttendees.eventId,
    profileId: profiles.id,
    name: profiles.name,
    color: profiles.color,
  }).from(eventAttendees)
    .innerJoin(profiles, eq(profiles.id, eventAttendees.profileId))
    .where(inArray(eventAttendees.eventId, ids))
    .all()
  const attendeesByEvent = new Map<string, { profileId: string, color: string, name: string }[]>()
  for (const row of attendeeRows) {
    const list = attendeesByEvent.get(row.eventId) ?? []
    list.push({ profileId: row.profileId, color: row.color, name: row.name })
    attendeesByEvent.set(row.eventId, list)
  }

  const feedIds = [...new Set(candidates.map(e => e.feedId).filter((x): x is string => !!x))]
  const feedById = new Map(
    feedIds.length
      ? db.select().from(calendarFeeds).where(inArray(calendarFeeds.id, feedIds)).all()
          .map(f => [f.id, f] as const)
      : [],
  )

  const out: CalendarOccurrence[] = []

  for (const event of candidates) {
    const exceptions = exceptionsByEvent.get(event.id) ?? new Map<number, ExceptionRow>()
    const attendees = attendeesByEvent.get(event.id) ?? []
    const feed = event.feedId ? feedById.get(event.feedId) : undefined
    const color = event.color ?? feed?.color ?? attendees[0]?.color ?? '#6366f1'
    const durationMs = !event.isAllDay ? (event.endAt!.getTime() - event.startAt!.getTime()) : 0

    const emit = (originalKeyMs: number, ex: ExceptionRow | undefined) => {
      if (ex?.kind === 'skipped') return
      const isException = ex?.kind === 'modified'

      if (event.isAllDay) {
        const date = decodeDateKey(originalKeyMs)
        const spanDays = event.rrule
          ? 1 // recurring all-day series recur per-date; multi-day spans don't repeat
          : Math.max(1, Math.round((encodeDateKey(event.endDate!) - encodeDateKey(event.startDate!)) / 86_400_000))
        const endDate = decodeDateKey(originalKeyMs + spanDays * 86_400_000)
        const startMs = DateTime.fromISO(date, { zone: timezone }).toMillis()
        const endMs = DateTime.fromISO(endDate, { zone: timezone }).toMillis()
        if (endMs <= windowStartMs || startMs >= windowEndMs) return
        out.push({
          occurrenceId: `${event.id}:${originalKeyMs}`,
          eventId: event.id,
          kind: event.feedId ? 'feed' : 'event',
          title: ex?.newTitle ?? event.title,
          description: ex?.newDescription ?? event.description,
          location: ex?.newLocation ?? event.location,
          isAllDay: true,
          start: startMs,
          end: endMs,
          startDate: date,
          endDate,
          color,
          attendees,
          readonly: !!event.feedId,
          isException,
          hasRecurrence: !!event.rrule,
          feedId: event.feedId,
        })
        return
      }

      const start = ex?.newStartAt?.getTime() ?? originalKeyMs
      const end = ex?.newEndAt?.getTime() ?? start + durationMs
      if (end <= windowStartMs || start >= windowEndMs) return
      out.push({
        occurrenceId: `${event.id}:${originalKeyMs}`,
        eventId: event.id,
        kind: event.feedId ? 'feed' : 'event',
        title: ex?.newTitle ?? event.title,
        description: ex?.newDescription ?? event.description,
        location: ex?.newLocation ?? event.location,
        isAllDay: false,
        start,
        end,
        color,
        attendees,
        readonly: !!event.feedId,
        isException,
        hasRecurrence: !!event.rrule,
        feedId: event.feedId,
      })
    }

    let originalKeys: number[]
    if (!event.rrule) {
      originalKeys = [event.isAllDay ? encodeDateKey(event.startDate!) : event.startAt!.getTime()]
    }
    else if (event.isAllDay) {
      originalKeys = expandDateRule({
        rruleBody: event.rrule,
        startDate: event.startDate!,
        windowStart: windowStartDate,
        windowEnd: windowEndDateExcl,
      }).map(encodeDateKey)
    }
    else {
      originalKeys = expandTimedRule({
        rruleBody: event.rrule,
        dtstartMs: event.startAt!.getTime(),
        timezone: event.timezone,
        windowStartMs,
        windowEndMs,
      })
    }

    const emitted = new Set<number>()
    for (const key of originalKeys) {
      emitted.add(key)
      emit(key, exceptions.get(key))
    }

    // Modified occurrences dragged INTO the window from outside it: their
    // original instant isn't in the expansion above, but their new time is.
    for (const [keyMs, ex] of exceptions) {
      if (ex.kind !== 'modified' || emitted.has(keyMs) || !ex.newStartAt) continue
      const newStart = ex.newStartAt.getTime()
      if (newStart >= windowStartMs && newStart < windowEndMs) emit(keyMs, ex)
    }
  }

  const filtered = args.profileIds?.length
    ? out.filter(o => o.attendees.some(a => args.profileIds!.includes(a.profileId)))
    : out

  return filtered.sort((a, b) =>
    a.start - b.start
    || Number(b.isAllDay) - Number(a.isAllDay)
    || a.title.localeCompare(b.title))
}

/** Convenience for reminders/agenda: next occurrences from `fromMs` forward. */
export function upcomingEvents(db: Db, args: Omit<ExpandEventsArgs, 'windowStartMs' | 'windowEndMs'> & { fromMs: number, horizonMs: number }) {
  return expandEvents(db, {
    ...args,
    windowStartMs: args.fromMs,
    windowEndMs: args.fromMs + args.horizonMs,
  })
}
