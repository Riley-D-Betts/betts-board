import { and, eq, gte } from 'drizzle-orm'
import type { EventCreate } from '#shared/schemas/events'
import type { Db } from '../../db/client'
import { eventAttendees, eventExceptions, events } from '../../db/schema'
import { encodeDateKey, decodeDateKey } from './expand'
import {
  computeDateRecurrenceEnd,
  computeRecurrenceEnd,
  truncateDateRuleBefore,
  truncateRuleBefore,
} from './recurrence'

type EventRow = typeof events.$inferSelect

function recurrenceEndFor(input: {
  rrule?: string | null
  isAllDay: boolean
  startAt?: number | null
  endAt?: number | null
  startDate?: string | null
  timezone: string
}): Date | null {
  if (!input.rrule) return null
  if (input.isAllDay) {
    const end = computeDateRecurrenceEnd(input.rrule, input.startDate!)
    // Encode the last date (+1 day so the whole day stays visible) as an instant.
    return end ? new Date(encodeDateKey(end) + 86_400_000) : null
  }
  const ms = computeRecurrenceEnd(
    input.rrule,
    input.startAt!,
    input.timezone,
    input.endAt! - input.startAt!,
  )
  return ms == null ? null : new Date(ms)
}

export function createEvent(db: Db, householdId: string, input: EventCreate, createdByProfileId?: string): EventRow {
  const row = db.insert(events).values({
    householdId,
    title: input.title,
    description: input.description ?? null,
    location: input.location ?? null,
    isAllDay: input.isAllDay,
    startAt: input.isAllDay ? null : new Date(input.startAt!),
    endAt: input.isAllDay ? null : new Date(input.endAt!),
    startDate: input.isAllDay ? input.startDate! : null,
    endDate: input.isAllDay ? input.endDate! : null,
    timezone: input.timezone,
    rrule: input.rrule ?? null,
    recurrenceEnd: recurrenceEndFor({ ...input, rrule: input.rrule }),
    reminderMinutes: input.reminderMinutes ?? null,
    color: input.color ?? null,
    createdByProfileId: createdByProfileId ?? null,
  }).returning().get()

  if (input.attendeeProfileIds.length) {
    db.insert(eventAttendees).values(
      input.attendeeProfileIds.map(profileId => ({ eventId: row.id, profileId })),
    ).run()
  }
  return row
}

function setAttendees(db: Db, eventId: string, profileIds: string[] | undefined) {
  if (profileIds === undefined) return
  db.delete(eventAttendees).where(eq(eventAttendees.eventId, eventId)).run()
  if (profileIds.length) {
    db.insert(eventAttendees).values(profileIds.map(profileId => ({ eventId, profileId }))).run()
  }
}

export type EventChanges = Partial<EventCreate>

/** Scope 'all': edit the master. Changing the schedule (rrule/start) drops
 * per-occurrence exceptions — they're keyed to instants that no longer exist. */
export function editAll(db: Db, event: EventRow, changes: EventChanges): EventRow {
  const next = {
    title: changes.title ?? event.title,
    description: changes.description !== undefined ? changes.description : event.description,
    location: changes.location !== undefined ? changes.location : event.location,
    isAllDay: changes.isAllDay ?? event.isAllDay,
    startAt: changes.startAt !== undefined ? (changes.startAt ? new Date(changes.startAt) : null) : event.startAt,
    endAt: changes.endAt !== undefined ? (changes.endAt ? new Date(changes.endAt) : null) : event.endAt,
    startDate: changes.startDate !== undefined ? (changes.startDate ?? null) : event.startDate,
    endDate: changes.endDate !== undefined ? (changes.endDate ?? null) : event.endDate,
    timezone: changes.timezone ?? event.timezone,
    rrule: changes.rrule !== undefined ? (changes.rrule ?? null) : event.rrule,
    reminderMinutes: changes.reminderMinutes !== undefined ? (changes.reminderMinutes ?? null) : event.reminderMinutes,
    color: changes.color !== undefined ? (changes.color ?? null) : event.color,
  }

  const scheduleChanged
    = changes.rrule !== undefined && changes.rrule !== event.rrule
      || changes.startAt !== undefined && changes.startAt !== event.startAt?.getTime()
      || changes.startDate !== undefined && changes.startDate !== event.startDate
      || changes.isAllDay !== undefined && changes.isAllDay !== event.isAllDay

  if (scheduleChanged) {
    db.delete(eventExceptions).where(eq(eventExceptions.eventId, event.id)).run()
  }

  const updated = db.update(events).set({
    ...next,
    recurrenceEnd: recurrenceEndFor({
      rrule: next.rrule,
      isAllDay: next.isAllDay,
      startAt: next.startAt?.getTime(),
      endAt: next.endAt?.getTime(),
      startDate: next.startDate,
      timezone: next.timezone,
    }),
  }).where(eq(events.id, event.id)).returning().get()

  setAttendees(db, event.id, changes.attendeeProfileIds)
  return updated
}

/** Scope 'this': upsert a modified-exception row with sparse overrides. */
export function editThis(db: Db, event: EventRow, occurrenceStart: number, changes: EventChanges) {
  const override = {
    kind: 'modified' as const,
    newStartAt: changes.startAt != null ? new Date(changes.startAt) : null,
    newEndAt: changes.endAt != null ? new Date(changes.endAt) : null,
    newTitle: changes.title ?? null,
    newLocation: changes.location !== undefined ? changes.location : null,
    newDescription: changes.description !== undefined ? changes.description : null,
  }
  db.insert(eventExceptions)
    .values({ eventId: event.id, occurrenceStart: new Date(occurrenceStart), ...override })
    .onConflictDoUpdate({
      target: [eventExceptions.eventId, eventExceptions.occurrenceStart],
      set: override,
    })
    .run()
}

/** Scope 'future': truncate the master before the split occurrence and create
 * a new master starting there (the standard Google-style series split). */
export function editFuture(db: Db, event: EventRow, occurrenceStart: number, changes: EventChanges): EventRow {
  if (!event.rrule) throw new Error('editFuture requires a recurring event')

  const truncated = event.isAllDay
    ? truncateDateRuleBefore(event.rrule, decodeDateKey(occurrenceStart))
    : truncateRuleBefore(event.rrule, occurrenceStart)

  db.update(events).set({
    rrule: truncated,
    recurrenceEnd: recurrenceEndFor({
      rrule: truncated,
      isAllDay: event.isAllDay,
      startAt: event.startAt?.getTime(),
      endAt: event.endAt?.getTime(),
      startDate: event.startDate,
      timezone: event.timezone,
    }),
  }).where(eq(events.id, event.id)).run()

  // Exceptions at/after the split belong to the new series; their occurrence
  // instants shift with any time change, so they can't be carried over.
  db.delete(eventExceptions).where(and(
    eq(eventExceptions.eventId, event.id),
    gte(eventExceptions.occurrenceStart, new Date(occurrenceStart)),
  )).run()

  const durationMs = event.isAllDay ? 0 : event.endAt!.getTime() - event.startAt!.getTime()
  const existingAttendees = db.select().from(eventAttendees)
    .where(eq(eventAttendees.eventId, event.id)).all()

  const base: EventCreate = {
    title: changes.title ?? event.title,
    description: changes.description !== undefined ? changes.description : event.description,
    location: changes.location !== undefined ? changes.location : event.location,
    isAllDay: changes.isAllDay ?? event.isAllDay,
    startAt: event.isAllDay ? null : (changes.startAt ?? occurrenceStart),
    endAt: event.isAllDay ? null : (changes.endAt ?? (changes.startAt ?? occurrenceStart) + durationMs),
    startDate: event.isAllDay ? (changes.startDate ?? decodeDateKey(occurrenceStart)) : null,
    endDate: event.isAllDay
      ? (changes.endDate ?? decodeDateKey(occurrenceStart + 86_400_000))
      : null,
    timezone: changes.timezone ?? event.timezone,
    rrule: changes.rrule !== undefined ? changes.rrule : event.rrule,
    reminderMinutes: changes.reminderMinutes !== undefined
      ? changes.reminderMinutes
      : event.reminderMinutes,
    color: changes.color !== undefined ? changes.color : event.color,
    attendeeProfileIds: changes.attendeeProfileIds ?? existingAttendees.map(a => a.profileId),
  }
  return createEvent(db, event.householdId, base, event.createdByProfileId ?? undefined)
}

export function deleteThis(db: Db, event: EventRow, occurrenceStart: number) {
  db.insert(eventExceptions)
    .values({ eventId: event.id, occurrenceStart: new Date(occurrenceStart), kind: 'skipped' })
    .onConflictDoUpdate({
      target: [eventExceptions.eventId, eventExceptions.occurrenceStart],
      set: {
        kind: 'skipped',
        newStartAt: null,
        newEndAt: null,
        newTitle: null,
        newLocation: null,
        newDescription: null,
      },
    })
    .run()
}

export function deleteFuture(db: Db, event: EventRow, occurrenceStart: number) {
  if (!event.rrule) throw new Error('deleteFuture requires a recurring event')
  const seriesStartKey = event.isAllDay ? encodeDateKey(event.startDate!) : event.startAt!.getTime()
  if (occurrenceStart <= seriesStartKey) {
    // Deleting from the first occurrence onward = deleting the whole series.
    db.delete(events).where(eq(events.id, event.id)).run()
    return
  }
  const truncated = event.isAllDay
    ? truncateDateRuleBefore(event.rrule, decodeDateKey(occurrenceStart))
    : truncateRuleBefore(event.rrule, occurrenceStart)
  db.update(events).set({
    rrule: truncated,
    recurrenceEnd: recurrenceEndFor({
      rrule: truncated,
      isAllDay: event.isAllDay,
      startAt: event.startAt?.getTime(),
      endAt: event.endAt?.getTime(),
      startDate: event.startDate,
      timezone: event.timezone,
    }),
  }).where(eq(events.id, event.id)).run()
  db.delete(eventExceptions).where(and(
    eq(eventExceptions.eventId, event.id),
    gte(eventExceptions.occurrenceStart, new Date(occurrenceStart)),
  )).run()
}

export function deleteAll(db: Db, event: EventRow) {
  db.delete(events).where(eq(events.id, event.id)).run()
}
