import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { DateTime } from 'luxon'
import { MAX_CHORE_BOARD_WINDOW_DAYS, choreBoardQuerySchema } from '#shared/schemas/chores'
import { MAX_CALENDAR_WINDOW_DAYS, calendarQuerySchema } from '#shared/schemas/events'
import { addDaysToDateString } from '#shared/utils/dates'
import { createDb, type Db } from '../../server/db/client'
import { defaultHouseholdSettings, events, households } from '../../server/db/schema'
import { MAX_OCCURRENCES_PER_EXPANSION, expandEvents } from '../../server/services/calendar/expand'
import {
  MAX_OCCURRENCES_PER_SERIES,
  MAX_TIMES_OF_DAY_PER_PERIOD,
  computeDateRecurrenceEnd,
  computeRecurrenceEnd,
  expandDateRule,
  expandTimedRule,
} from '../../server/services/calendar/recurrence'

/**
 * The attack: one GET, unbounded work.
 *
 * `/api/calendar?start=0&end=99999999999999` used to be a valid request, and
 * the expander would happily walk a daily series across three thousand years
 * inside the single container the whole household shares. Two independent
 * bounds stop it, and each is tested on its own here because either one alone
 * is defeatable: the schema caps the window a caller may ask for, and the
 * expander caps the occurrences it will produce whatever it is handed —
 * including rules that were stored before zRRule learned to reject them, and
 * rules an ICS feed imported from a publisher nobody in the house controls.
 */

const ZONE = 'America/Boise'
const boise = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toMillis()
const DAY_MS = 86_400_000

let db: Db
let householdId: string

beforeEach(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  householdId = db.insert(households).values({
    name: 'Test',
    passwordHash: 'x',
    timezone: ZONE,
    icsToken: 'tok',
    settings: defaultHouseholdSettings,
  }).returning().get().id
})

/** Writes an event straight to the table, the way an ICS import or a row from
 * before the schema tightened would exist — no zod on the way in. */
function storeRawEvent(rrule: string, startAt = boise('2020-01-01T09:00:00')) {
  return db.insert(events).values({
    householdId,
    title: 'Legacy',
    isAllDay: false,
    startAt: new Date(startAt),
    endAt: new Date(startAt + 3_600_000),
    timezone: ZONE,
    rrule,
  }).returning().get()
}

function window(startMs: number, days: number) {
  return { householdId, windowStartMs: startMs, windowEndMs: startMs + days * DAY_MS, timezone: ZONE }
}

describe('calendarQuerySchema', () => {
  const start = boise('2026-02-01T00:00:00')

  it('accepts every window the screens actually ask for', () => {
    for (const days of [1, 7, 30, 42, MAX_CALENDAR_WINDOW_DAYS]) {
      expect(() => calendarQuerySchema.parse({ start, end: start + days * DAY_MS }), `${days}d`)
        .not.toThrow()
    }
  })

  it('refuses a century of calendar in one request', () => {
    const century = start + 365 * 100 * DAY_MS
    expect(() => calendarQuerySchema.parse({ start, end: century })).toThrow()
    // One day past the cap is already too much — the boundary is the boundary.
    expect(() => calendarQuerySchema.parse({
      start, end: start + (MAX_CALENDAR_WINDOW_DAYS + 1) * DAY_MS,
    })).toThrow()
  })

  it('refuses a window that does not move forwards', () => {
    expect(() => calendarQuerySchema.parse({ start, end: start })).toThrow()
    expect(() => calendarQuerySchema.parse({ start, end: start - 1 })).toThrow()
  })

  it('refuses instants no Date can represent', () => {
    // Past this, luxon yields Invalid DateTime and the window silently becomes
    // nulls and NaNs in the SQL comparison instead of an error.
    expect(() => calendarQuerySchema.parse({ start: 1e18, end: 1e18 + DAY_MS })).toThrow()
    expect(() => calendarQuerySchema.parse({ start: -1e18, end: -1e18 + DAY_MS })).toThrow()
  })

  it('refuses an unbounded profile filter', () => {
    // The filter runs per occurrence in JS; an id list of any length makes the
    // request quadratic in something the caller controls.
    expect(() => calendarQuerySchema.parse({
      start, end: start + DAY_MS, profileIds: 'x,'.repeat(5000),
    })).toThrow()
  })

  it('still coerces the query strings a browser actually sends', () => {
    const parsed = calendarQuerySchema.parse({
      start: String(start), end: String(start + 42 * DAY_MS), profileIds: 'a,b',
    })
    expect(parsed).toMatchObject({ start, end: start + 42 * DAY_MS, profileIds: 'a,b' })
  })
})

describe('the expander caps itself, whatever it is handed', () => {
  it('never produces more than the per-series cap, even when asked to', () => {
    // 24 occurrences a day for a year is well past the cap — and the `limit`
    // argument cannot be used to raise it.
    const out = expandTimedRule({
      rruleBody: 'FREQ=DAILY;BYHOUR=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23',
      dtstartMs: boise('2026-01-01T00:00:00'),
      timezone: ZONE,
      windowStartMs: boise('2026-01-01T00:00:00'),
      windowEndMs: boise('2026-01-01T00:00:00') + 366 * DAY_MS,
      limit: Number.MAX_SAFE_INTEGER,
    })
    expect(out.length).toBe(MAX_OCCURRENCES_PER_SERIES)
  })

  it('honours a smaller budget handed down by the caller', () => {
    const out = expandDateRule({
      rruleBody: 'FREQ=DAILY',
      startDate: '2026-01-01',
      windowStart: '2026-01-01',
      windowEnd: '2027-01-01',
      limit: 10,
    })
    expect(out).toHaveLength(10)
    expect(out[0]).toBe('2026-01-01')
  })

  /**
   * The one that used to hang. rrule steps from DTSTART, so a per-second rule
   * starting in 2020 has to take ~190 million steps before it reaches a window
   * in 2026 — a count limit on the RESULTS never gets a chance to fire. The
   * rule is refused outright instead, and the series shows its DTSTART only.
   */
  it('does not iterate a frequency it refuses, however old the DTSTART', () => {
    const began = Date.now()
    const out = expandTimedRule({
      rruleBody: 'FREQ=SECONDLY',
      dtstartMs: boise('2020-01-01T09:00:00'),
      timezone: ZONE,
      windowStartMs: boise('2026-02-01T00:00:00'),
      windowEndMs: boise('2026-03-01T00:00:00'),
    })
    expect(out).toEqual([])
    expect(Date.now() - began).toBeLessThan(2000)
  })

  it('degrades a refused rule to its first occurrence rather than dropping it', () => {
    const dtstart = boise('2026-02-02T09:00:00')
    const out = expandTimedRule({
      rruleBody: 'FREQ=MINUTELY;INTERVAL=5',
      dtstartMs: dtstart,
      timezone: ZONE,
      windowStartMs: boise('2026-02-01T00:00:00'),
      windowEndMs: boise('2026-03-01T00:00:00'),
    })
    expect(out).toEqual([dtstart])
  })

  it('refuses INTERVAL=0, which iterates without ever advancing', () => {
    expect(expandDateRule({
      rruleBody: 'FREQ=DAILY;INTERVAL=0',
      startDate: '2026-01-01',
      windowStart: '2026-01-01',
      windowEnd: '2026-02-01',
    })).toEqual(['2026-01-01'])
  })

  /**
   * The same outage as FREQ=SECONDLY, reached through a FREQ the schema allows.
   * BYHOUR/BYMINUTE/BYSECOND multiply inside each period, so FREQ=DAILY with
   * all three listed in full is 86,400 occurrences a day — and rrule builds
   * every one of them walking from a 2020 DTSTART to a 2026 window, where the
   * result cap (which only counts occurrences INSIDE the window) never fires.
   * Unguarded this measured 113s of blocked CPU for a one-day window.
   */
  it('refuses a rule whose BY-parts multiply into a sub-hourly series', () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => i).join(',')
    const dtstart = boise('2020-01-01T00:00:00')
    const began = Date.now()
    const out = expandTimedRule({
      rruleBody: `FREQ=DAILY;BYHOUR=${list(24)};BYMINUTE=${list(60)};BYSECOND=${list(60)}`,
      dtstartMs: dtstart,
      timezone: ZONE,
      windowStartMs: boise('2026-02-01T00:00:00'),
      windowEndMs: boise('2026-02-02T00:00:00'),
    })
    expect(out).toEqual([]) // DTSTART is in 2020, outside the window
    expect(Date.now() - began).toBeLessThan(2000)
  })

  it('refuses the cheaper BYHOUR×BYMINUTE form too, and prunes it in the DB', () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => i).join(',')
    // 1,440 a day — 15s of CPU unguarded, and still nothing a calendar publishes.
    const body = `FREQ=DAILY;BYHOUR=${list(24)};BYMINUTE=${list(60)}`
    const dtstart = boise('2026-02-02T09:00:00')
    const began = Date.now()
    expect(expandTimedRule({
      rruleBody: body,
      dtstartMs: dtstart,
      timezone: ZONE,
      windowStartMs: boise('2026-02-01T00:00:00'),
      windowEndMs: boise('2026-03-01T00:00:00'),
    })).toEqual([dtstart])
    expect(Date.now() - began).toBeLessThan(2000)
    // recurrenceEnd must agree, or the window query keeps selecting the row.
    expect(computeRecurrenceEnd(body, dtstart, ZONE, 3_600_000)).toBe(dtstart + 3_600_000)
  })

  it('still expands the BY-part rules a calendar really publishes', () => {
    // Every hour of the working day, and a twice-an-hour series: both under the
    // cap, both must keep working.
    const workday = expandTimedRule({
      rruleBody: 'FREQ=DAILY;BYHOUR=9,10,11,12,13,14,15,16',
      dtstartMs: boise('2026-02-02T09:00:00'),
      timezone: ZONE,
      windowStartMs: boise('2026-02-02T00:00:00'),
      windowEndMs: boise('2026-02-03T00:00:00'),
    })
    expect(workday).toHaveLength(8)

    expect(MAX_TIMES_OF_DAY_PER_PERIOD).toBeGreaterThanOrEqual(24)
    const halfPast = expandTimedRule({
      rruleBody: 'FREQ=DAILY;BYHOUR=8,9;BYMINUTE=0,30',
      dtstartMs: boise('2026-02-02T08:00:00'),
      timezone: ZONE,
      windowStartMs: boise('2026-02-02T00:00:00'),
      windowEndMs: boise('2026-02-03T00:00:00'),
    })
    expect(halfPast).toHaveLength(4)
  })

  it('ends a refused series at its first occurrence, so the window query prunes it', () => {
    const dtstart = boise('2026-02-02T09:00:00')
    expect(computeRecurrenceEnd('FREQ=SECONDLY', dtstart, ZONE, 3_600_000))
      .toBe(dtstart + 3_600_000)
    expect(computeDateRecurrenceEnd('FREQ=MINUTELY', '2026-02-02')).toBe('2026-02-02')
  })
})

/**
 * The chores board is the same endpoint shape as the calendar, and had the
 * same hole: it expands every active chore across the window and then
 * multiplies by every assignee. Measured before this cap, twenty daily chores
 * and four kids over `0001-01-01`..`9999-12-31` produced 400,000 instances —
 * about 112 MB of JSON — from one GET.
 */
describe('choreBoardQuerySchema', () => {
  it('accepts the windows the screens ask for', () => {
    for (const [start, end] of [
      ['2026-02-01', '2026-02-02'], // today tile, TV
      ['2026-02-02', '2026-02-09'], // chores page (a week)
      ['2026-02-01', '2027-02-01'], // a year, well past any screen
    ]) {
      expect(() => choreBoardQuerySchema.parse({ start, end }), `${start}..${end}`).not.toThrow()
    }
  })

  it('refuses a window no screen could use', () => {
    expect(() => choreBoardQuerySchema.parse({ start: '0001-01-01', end: '9999-12-31' })).toThrow()
    expect(() => choreBoardQuerySchema.parse({
      start: '2026-01-01',
      end: addDaysToDateString('2026-01-01', MAX_CHORE_BOARD_WINDOW_DAYS + 1),
    })).toThrow()
  })
})

describe('expandEvents', () => {
  it('bounds a stored sub-hourly series to one occurrence, in milliseconds', () => {
    storeRawEvent('FREQ=SECONDLY') // never re-validated after it was written
    const began = Date.now()
    const out = expandEvents(db, window(boise('2026-02-01T00:00:00'), 42))
    expect(out).toHaveLength(0) // DTSTART is in 2020, outside the window
    expect(Date.now() - began).toBeLessThan(2000)
  })

  it('bounds the whole expansion, not just each series', () => {
    // 60 daily series over a year is 21,960 occurrences — past the budget.
    const start = boise('2026-01-01T00:00:00')
    for (let i = 0; i < 60; i++) storeRawEvent('FREQ=DAILY', start + i * 60_000)

    const out = expandEvents(db, window(start, MAX_CALENDAR_WINDOW_DAYS))
    // Exactly the budget, not the 21,960 the data would otherwise yield.
    expect(out.length).toBe(MAX_OCCURRENCES_PER_EXPANSION)
  })

  it('leaves an ordinary month of an ordinary series untouched', () => {
    storeRawEvent('FREQ=WEEKLY;BYDAY=MO', boise('2026-02-02T17:00:00'))
    const out = expandEvents(db, window(boise('2026-02-01T00:00:00'), 28))
    expect(out).toHaveLength(4)
  })
})
