import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { DateTime } from 'luxon'
import { createDb, type Db } from '../../server/db/client'
import { defaultHouseholdSettings, households, profiles } from '../../server/db/schema'
import { encodeDateKey, expandEvents } from '../../server/services/calendar/expand'
import {
  createEvent,
  deleteFuture,
  deleteThis,
  editAll,
  editFuture,
  editThis,
} from '../../server/services/calendar/events'

const ZONE = 'America/Boise'
const boise = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toMillis()

let db: Db
let householdId: string
let mom: string
let kid: string

beforeEach(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  const hh = db.insert(households).values({
    name: 'Test',
    passwordHash: 'x',
    timezone: ZONE,
    icsToken: 'tok',
    settings: defaultHouseholdSettings,
  }).returning().get()
  householdId = hh.id
  mom = db.insert(profiles).values({ householdId, name: 'Mom', color: '#ec4899' }).returning().get().id
  kid = db.insert(profiles).values({ householdId, name: 'Kid', color: '#22c55e' }).returning().get().id
})

function window(startIso: string, endIso: string) {
  return {
    householdId,
    windowStartMs: boise(startIso),
    windowEndMs: boise(endIso),
    timezone: ZONE,
  }
}

describe('expandEvents', () => {
  it('returns one-off timed events overlapping the window with attendees', () => {
    createEvent(db, householdId, {
      title: 'Dentist',
      isAllDay: false,
      startAt: boise('2026-02-03T14:00:00'),
      endAt: boise('2026-02-03T15:00:00'),
      timezone: ZONE,
      attendeeProfileIds: [mom, kid],
    })
    const out = expandEvents(db, window('2026-02-01T00:00:00', '2026-02-08T00:00:00'))
    expect(out).toHaveLength(1)
    expect(out[0]!.title).toBe('Dentist')
    expect(out[0]!.attendees.map(a => a.name).sort()).toEqual(['Kid', 'Mom'])
    expect(out[0]!.color).toBe('#ec4899') // first attendee's color
    expect(out[0]!.hasRecurrence).toBe(false)

    // Outside the window → nothing.
    expect(expandEvents(db, window('2026-02-08T00:00:00', '2026-02-15T00:00:00'))).toHaveLength(0)
  })

  it('expands weekly series and applies skip + modify exceptions', () => {
    const ev = createEvent(db, householdId, {
      title: 'Soccer',
      isAllDay: false,
      startAt: boise('2026-02-02T17:00:00'), // Mondays
      endAt: boise('2026-02-02T18:00:00'),
      timezone: ZONE,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      attendeeProfileIds: [kid],
    })
    // Skip Feb 16, move Feb 9 to 18:30 with a new title.
    deleteThis(db, ev, boise('2026-02-16T17:00:00'))
    editThis(db, ev, boise('2026-02-09T17:00:00'), {
      startAt: boise('2026-02-09T18:30:00'),
      endAt: boise('2026-02-09T19:30:00'),
      title: 'Soccer (makeup time)',
    })

    const out = expandEvents(db, window('2026-02-01T00:00:00', '2026-03-01T00:00:00'))
    const starts = out.map(o => DateTime.fromMillis(o.start, { zone: ZONE }).toFormat('MM-dd HH:mm'))
    expect(starts).toEqual(['02-02 17:00', '02-09 18:30', '02-23 17:00'])
    const modified = out.find(o => o.isException)!
    expect(modified.title).toBe('Soccer (makeup time)')
    // Edit key still points at the ORIGINAL instant.
    expect(modified.occurrenceId).toBe(`${ev.id}:${boise('2026-02-09T17:00:00')}`)
  })

  it('shows occurrences moved INTO the window from outside it', () => {
    const ev = createEvent(db, householdId, {
      title: 'Book club',
      isAllDay: false,
      startAt: boise('2026-01-28T19:00:00'), // last Wed of Jan
      endAt: boise('2026-01-28T20:00:00'),
      timezone: ZONE,
      rrule: 'FREQ=MONTHLY;BYDAY=-1WE',
      attendeeProfileIds: [mom],
    })
    // January's meeting rescheduled into February.
    editThis(db, ev, boise('2026-01-28T19:00:00'), {
      startAt: boise('2026-02-04T19:00:00'),
      endAt: boise('2026-02-04T20:00:00'),
    })
    const feb = expandEvents(db, window('2026-02-01T00:00:00', '2026-03-01T00:00:00'))
    const titles = feb.map(o => `${o.title}@${DateTime.fromMillis(o.start, { zone: ZONE }).toFormat('MM-dd')}`)
    expect(titles).toContain('Book club@02-04') // moved in
    expect(titles).toContain('Book club@02-25') // February's own occurrence
    // And January no longer shows it.
    const jan = expandEvents(db, window('2026-01-25T00:00:00', '2026-02-01T00:00:00'))
    expect(jan).toHaveLength(0)
  })

  it('expands recurring all-day events on date strings', () => {
    createEvent(db, householdId, {
      title: 'Trash day',
      isAllDay: true,
      startDate: '2026-02-06', // Fridays
      endDate: '2026-02-07',
      timezone: ZONE,
      rrule: 'FREQ=WEEKLY;BYDAY=FR',
      attendeeProfileIds: [],
    })
    const out = expandEvents(db, window('2026-02-01T00:00:00', '2026-03-01T00:00:00'))
    expect(out.map(o => o.startDate)).toEqual(['2026-02-06', '2026-02-13', '2026-02-20', '2026-02-27'])
    expect(out.every(o => o.isAllDay)).toBe(true)
  })

  it('prunes series that ended before the window (recurrenceEnd)', () => {
    createEvent(db, householdId, {
      title: 'Short series',
      isAllDay: false,
      startAt: boise('2026-01-05T10:00:00'),
      endAt: boise('2026-01-05T11:00:00'),
      timezone: ZONE,
      rrule: 'FREQ=DAILY;COUNT=3', // ends Jan 7
      attendeeProfileIds: [],
    })
    expect(expandEvents(db, window('2026-01-05T00:00:00', '2026-01-10T00:00:00'))).toHaveLength(3)
    expect(expandEvents(db, window('2026-02-01T00:00:00', '2026-03-01T00:00:00'))).toHaveLength(0)
  })

  it('filters by attendee profiles', () => {
    createEvent(db, householdId, {
      title: 'Mom thing',
      isAllDay: false,
      startAt: boise('2026-02-03T09:00:00'),
      endAt: boise('2026-02-03T10:00:00'),
      timezone: ZONE,
      attendeeProfileIds: [mom],
    })
    createEvent(db, householdId, {
      title: 'Kid thing',
      isAllDay: false,
      startAt: boise('2026-02-03T11:00:00'),
      endAt: boise('2026-02-03T12:00:00'),
      timezone: ZONE,
      attendeeProfileIds: [kid],
    })
    const out = expandEvents(db, { ...window('2026-02-01T00:00:00', '2026-02-08T00:00:00'), profileIds: [kid] })
    expect(out.map(o => o.title)).toEqual(['Kid thing'])
  })
})

describe('scope edits', () => {
  it('editFuture splits a series with no lost or duplicated occurrences', () => {
    const ev = createEvent(db, householdId, {
      title: 'Piano',
      isAllDay: false,
      startAt: boise('2026-01-06T16:00:00'), // Tuesdays
      endAt: boise('2026-01-06T16:30:00'),
      timezone: ZONE,
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      attendeeProfileIds: [kid],
    })
    // From Feb 3 onward, lessons move to 17:00.
    editFuture(db, ev, boise('2026-02-03T16:00:00'), {
      startAt: boise('2026-02-03T17:00:00'),
      endAt: boise('2026-02-03T17:30:00'),
    })

    const out = expandEvents(db, window('2026-01-01T00:00:00', '2026-03-01T00:00:00'))
    const times = out.map(o => DateTime.fromMillis(o.start, { zone: ZONE }).toFormat('MM-dd HH:mm'))
    expect(times).toEqual([
      '01-06 16:00', '01-13 16:00', '01-20 16:00', '01-27 16:00',
      '02-03 17:00', '02-10 17:00', '02-17 17:00', '02-24 17:00',
    ])
    // Attendees carried over to the new series.
    expect(out.at(-1)!.attendees.map(a => a.name)).toEqual(['Kid'])
    // Two distinct series now.
    expect(new Set(out.map(o => o.eventId)).size).toBe(2)
  })

  it('deleteFuture truncates; deleting from the first occurrence removes the series', () => {
    const ev = createEvent(db, householdId, {
      title: 'Standup',
      isAllDay: false,
      startAt: boise('2026-01-05T09:00:00'),
      endAt: boise('2026-01-05T09:15:00'),
      timezone: ZONE,
      rrule: 'FREQ=DAILY',
      attendeeProfileIds: [],
    })
    deleteFuture(db, ev, boise('2026-01-08T09:00:00'))
    const out = expandEvents(db, window('2026-01-01T00:00:00', '2026-02-01T00:00:00'))
    expect(out).toHaveLength(3) // Jan 5, 6, 7

    const ev2 = createEvent(db, householdId, {
      title: 'Doomed',
      isAllDay: false,
      startAt: boise('2026-01-05T09:00:00'),
      endAt: boise('2026-01-05T09:15:00'),
      timezone: ZONE,
      rrule: 'FREQ=DAILY',
      attendeeProfileIds: [],
    })
    deleteFuture(db, ev2, boise('2026-01-05T09:00:00'))
    const after = expandEvents(db, window('2026-01-01T00:00:00', '2026-02-01T00:00:00'))
    expect(after.filter(o => o.title === 'Doomed')).toHaveLength(0)
  })

  it('editAll schedule change drops stale exceptions', () => {
    const ev = createEvent(db, householdId, {
      title: 'Gym',
      isAllDay: false,
      startAt: boise('2026-01-05T06:00:00'),
      endAt: boise('2026-01-05T07:00:00'),
      timezone: ZONE,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      attendeeProfileIds: [],
    })
    deleteThis(db, ev, boise('2026-01-12T06:00:00'))
    expect(expandEvents(db, window('2026-01-01T00:00:00', '2026-02-01T00:00:00'))).toHaveLength(3)

    // Moving the series to Wednesdays invalidates the Monday-keyed skip.
    const updated = editAll(db, ev, {
      startAt: boise('2026-01-07T06:00:00'),
      endAt: boise('2026-01-07T07:00:00'),
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
    })
    expect(updated.rrule).toBe('FREQ=WEEKLY;BYDAY=WE')
    const out = expandEvents(db, window('2026-01-01T00:00:00', '2026-02-01T00:00:00'))
    expect(out).toHaveLength(4) // Jan 7, 14, 21, 28 — no skip survives
  })

  it('all-day exceptions key by encoded date', () => {
    const ev = createEvent(db, householdId, {
      title: 'Trash day',
      isAllDay: true,
      startDate: '2026-02-06',
      endDate: '2026-02-07',
      timezone: ZONE,
      rrule: 'FREQ=WEEKLY;BYDAY=FR',
      attendeeProfileIds: [],
    })
    deleteThis(db, ev, encodeDateKey('2026-02-13')) // holiday week — no pickup
    const out = expandEvents(db, window('2026-02-01T00:00:00', '2026-03-01T00:00:00'))
    expect(out.map(o => o.startDate)).toEqual(['2026-02-06', '2026-02-20', '2026-02-27'])
  })
})
