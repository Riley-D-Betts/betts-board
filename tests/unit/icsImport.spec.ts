import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { createDb, type Db } from '../../server/db/client'
import { calendarFeeds, defaultHouseholdSettings, eventExceptions, events, households } from '../../server/db/schema'
import { expandEvents } from '../../server/services/calendar/expand'
import { normalizeFeedUrl, refreshFeed } from '../../server/services/ics/import'

const ZONE = 'America/Denver'
const denver = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toMillis()

const sampleIcs = readFileSync(new URL('../fixtures/ics/sample.ics', import.meta.url), 'utf8')

/** Drop the VEVENT block(s) containing the given UID from an ics text. */
function withoutUid(ics: string, uid: string): string {
  const [head, ...blocks] = ics.split('BEGIN:VEVENT')
  return head + blocks
    .filter(b => !b.includes(`UID:${uid}`))
    .map(b => 'BEGIN:VEVENT' + b)
    .join('')
}

let db: Db
let householdId: string
let feed: typeof calendarFeeds.$inferSelect

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
  feed = db.insert(calendarFeeds).values({
    householdId,
    name: 'School',
    url: 'https://school.example/cal.ics',
    color: '#0ea5e9',
  }).returning().get()
})

function feedRow() {
  return db.select().from(calendarFeeds).where(eq(calendarFeeds.id, feed.id)).get()!
}

function feedEvents() {
  return db.select().from(events).where(eq(events.feedId, feed.id)).all()
}

describe('normalizeFeedUrl', () => {
  it('rewrites webcal:// to https://', () => {
    expect(normalizeFeedUrl('webcal://cal.example/x.ics')).toBe('https://cal.example/x.ics')
    expect(normalizeFeedUrl('WEBCAL://cal.example/x.ics')).toBe('https://cal.example/x.ics')
    expect(normalizeFeedUrl('https://cal.example/x.ics')).toBe('https://cal.example/x.ics')
  })
})

describe('refreshFeed', () => {
  it('imports timed, all-day and recurring VEVENTs with exceptions', async () => {
    const result = await refreshFeed(db, feed, { icsText: sampleIcs })
    expect(result).toMatchObject({ ok: true, imported: 3, deleted: 0 })

    const rows = feedEvents()
    expect(rows).toHaveLength(3)

    const simple = rows.find(e => e.externalUid === 'simple-1@school.example')!
    expect(simple.title).toBe('Parent-teacher conference')
    expect(simple.location).toBe('Room 12')
    expect(simple.description).toBe('Bring the reading log')
    expect(simple.isAllDay).toBe(false)
    expect(simple.startAt!.getTime()).toBe(denver('2026-02-03T14:00:00'))
    expect(simple.endAt!.getTime()).toBe(denver('2026-02-03T15:00:00'))
    expect(simple.timezone).toBe(ZONE)
    expect(simple.rrule).toBeNull()

    const allday = rows.find(e => e.externalUid === 'allday-1@school.example')!
    expect(allday.isAllDay).toBe(true)
    expect(allday.startDate).toBe('2026-02-10')
    expect(allday.endDate).toBe('2026-02-11') // missing DTEND → +1 day, exclusive
    expect(allday.startAt).toBeNull()

    const weekly = rows.find(e => e.externalUid === 'weekly-1@school.example')!
    expect(weekly.rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(weekly.startAt!.getTime()).toBe(denver('2026-02-02T17:00:00'))
    expect(weekly.timezone).toBe(ZONE)
    expect(weekly.recurrenceEnd).toBeNull() // no UNTIL/COUNT → repeats forever

    const exceptions = db.select().from(eventExceptions)
      .where(eq(eventExceptions.eventId, weekly.id)).all()
    expect(exceptions).toHaveLength(2)

    const skipped = exceptions.find(x => x.kind === 'skipped')!
    expect(skipped.occurrenceStart.getTime()).toBe(denver('2026-02-16T17:00:00'))

    const modified = exceptions.find(x => x.kind === 'modified')!
    expect(modified.occurrenceStart.getTime()).toBe(denver('2026-02-09T17:00:00'))
    expect(modified.newStartAt!.getTime()).toBe(denver('2026-02-09T18:30:00'))
    expect(modified.newEndAt!.getTime()).toBe(denver('2026-02-09T19:30:00'))
    expect(modified.newTitle).toBe('Soccer practice (moved to evening)')
    expect(modified.newLocation).toBe('West field')

    const updatedFeed = feedRow()
    expect(updatedFeed.lastStatus).toBe('ok')
    expect(updatedFeed.lastError).toBeNull()
    expect(updatedFeed.lastFetchedAt).not.toBeNull()
  })

  it('upserts on refresh: no duplicates, changed fields updated in place', async () => {
    await refreshFeed(db, feed, { icsText: sampleIcs })
    const beforeIds = new Map(feedEvents().map(e => [e.externalUid, e.id]))

    const changed = sampleIcs.replace('SUMMARY:Parent-teacher conference', 'SUMMARY:Conference (rescheduled room)')
    const result = await refreshFeed(db, feed, { icsText: changed })
    expect(result).toMatchObject({ ok: true, imported: 3, deleted: 0 })

    const rows = feedEvents()
    expect(rows).toHaveLength(3)
    const simple = rows.find(e => e.externalUid === 'simple-1@school.example')!
    expect(simple.title).toBe('Conference (rescheduled room)')
    expect(simple.id).toBe(beforeIds.get('simple-1@school.example')) // same row, updated

    // Exceptions are rebuilt, not duplicated.
    const weekly = rows.find(e => e.externalUid === 'weekly-1@school.example')!
    const exceptions = db.select().from(eventExceptions)
      .where(eq(eventExceptions.eventId, weekly.id)).all()
    expect(exceptions).toHaveLength(2)
  })

  it('deletes events whose uid vanished from the feed', async () => {
    await refreshFeed(db, feed, { icsText: sampleIcs })
    expect(feedEvents()).toHaveLength(3)

    const result = await refreshFeed(db, feed, { icsText: withoutUid(sampleIcs, 'simple-1@school.example') })
    expect(result).toMatchObject({ ok: true, imported: 2, deleted: 1 })

    const rows = feedEvents()
    expect(rows).toHaveLength(2)
    expect(rows.find(e => e.externalUid === 'simple-1@school.example')).toBeUndefined()
  })

  it('records fetch failures on the feed instead of throwing', async () => {
    await refreshFeed(db, feed, { icsText: sampleIcs })

    const result = await refreshFeed(db, feedRow(), {
      fetchIcs: () => Promise.reject(new Error('boom')),
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('boom')

    const row = feedRow()
    expect(row.lastStatus).toBe('error')
    expect(row.lastError).toBe('boom')
    // Previously imported events survive a failed refresh.
    expect(feedEvents()).toHaveLength(3)
  })

  it('expandEvents shows feed occurrences as readonly with exceptions applied', async () => {
    await refreshFeed(db, feed, { icsText: sampleIcs })

    const out = expandEvents(db, {
      householdId,
      windowStartMs: denver('2026-02-01T00:00:00'),
      windowEndMs: denver('2026-03-01T00:00:00'),
      timezone: ZONE,
    })

    expect(out.every(o => o.readonly && o.kind === 'feed' && o.feedId === feed.id)).toBe(true)
    expect(out.every(o => o.color === '#0ea5e9')).toBe(true) // feed color fallback

    const soccer = out.filter(o => o.title.startsWith('Soccer'))
    const starts = soccer.map(o => DateTime.fromMillis(o.start, { zone: ZONE }).toFormat('MM-dd HH:mm'))
    // Feb 16 EXDATEd, Feb 9 moved to 18:30 by the RECURRENCE-ID override.
    expect(starts).toEqual(['02-02 17:00', '02-09 18:30', '02-23 17:00'])
    const moved = soccer.find(o => o.isException)!
    expect(moved.title).toBe('Soccer practice (moved to evening)')
    expect(moved.location).toBe('West field')

    expect(out.find(o => o.title === 'Teacher work day - no school')).toMatchObject({
      isAllDay: true,
      startDate: '2026-02-10',
      endDate: '2026-02-11',
    })
    expect(out.find(o => o.title === 'Parent-teacher conference')).toBeDefined()
  })
})
