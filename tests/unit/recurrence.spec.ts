import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import {
  computeDateRecurrenceEnd,
  computeRecurrenceEnd,
  expandDateRule,
  expandTimedRule,
  truncateDateRuleBefore,
  truncateRuleBefore,
} from '../../server/services/calendar/recurrence'

const ZONE = 'America/Boise'

function boise(iso: string): number {
  return DateTime.fromISO(iso, { zone: ZONE }).toMillis()
}

function wallTimes(instants: number[]): string[] {
  return instants.map(ms => DateTime.fromMillis(ms, { zone: ZONE }).toFormat('yyyy-MM-dd HH:mm'))
}

describe('expandTimedRule', () => {
  it('keeps 07:00 wall time across US spring-forward (2026-03-08)', () => {
    // Weekly Sunday 7:00 AM starting Feb 22, expanded across the DST jump.
    const out = expandTimedRule({
      rruleBody: 'FREQ=WEEKLY;BYDAY=SU',
      dtstartMs: boise('2026-02-22T07:00:00'),
      timezone: ZONE,
      windowStartMs: boise('2026-02-22T00:00:00'),
      windowEndMs: boise('2026-03-23T00:00:00'),
    })
    expect(wallTimes(out)).toEqual([
      '2026-02-22 07:00',
      '2026-03-01 07:00',
      '2026-03-08 07:00', // DST starts this morning — still 07:00 local
      '2026-03-15 07:00',
      '2026-03-22 07:00',
    ])
    // The UTC offsets differ before/after the jump: instants 1 week apart
    // are NOT exactly 7*24h apart across the transition.
    expect(out[3]! - out[2]!).toBe(7 * 24 * 3600_000)
    expect(out[2]! - out[1]!).toBe(7 * 24 * 3600_000 - 3600_000)
  })

  it('keeps 07:00 wall time across US fall-back (2026-11-01)', () => {
    const out = expandTimedRule({
      rruleBody: 'FREQ=WEEKLY;BYDAY=SU',
      dtstartMs: boise('2026-10-18T07:00:00'),
      timezone: ZONE,
      windowStartMs: boise('2026-10-18T00:00:00'),
      windowEndMs: boise('2026-11-16T00:00:00'),
    })
    expect(wallTimes(out)).toEqual([
      '2026-10-18 07:00',
      '2026-10-25 07:00',
      '2026-11-01 07:00', // fall-back morning — still 07:00 local
      '2026-11-08 07:00',
      '2026-11-15 07:00',
    ])
    expect(out[2]! - out[1]!).toBe(7 * 24 * 3600_000 + 3600_000)
  })

  it('expands every-2-weeks on Mon/Wed', () => {
    // Monday 2026-01-05 18:00, biweekly Mon+Wed.
    const out = expandTimedRule({
      rruleBody: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
      dtstartMs: boise('2026-01-05T18:00:00'),
      timezone: ZONE,
      windowStartMs: boise('2026-01-01T00:00:00'),
      windowEndMs: boise('2026-02-06T00:00:00'),
    })
    expect(wallTimes(out)).toEqual([
      '2026-01-05 18:00',
      '2026-01-07 18:00',
      '2026-01-19 18:00',
      '2026-01-21 18:00',
      '2026-02-02 18:00',
      '2026-02-04 18:00',
    ])
  })

  it('monthly on the 31st skips short months', () => {
    const out = expandTimedRule({
      rruleBody: 'FREQ=MONTHLY',
      dtstartMs: boise('2026-01-31T12:00:00'),
      timezone: ZONE,
      windowStartMs: boise('2026-01-01T00:00:00'),
      windowEndMs: boise('2026-06-01T00:00:00'),
    })
    // Feb (28d) and Apr (30d) have no 31st.
    expect(wallTimes(out)).toEqual([
      '2026-01-31 12:00',
      '2026-03-31 12:00',
      '2026-05-31 12:00',
    ])
  })

  it('quarterly = FREQ=MONTHLY;INTERVAL=3', () => {
    const out = expandTimedRule({
      rruleBody: 'FREQ=MONTHLY;INTERVAL=3',
      dtstartMs: boise('2026-01-15T09:00:00'),
      timezone: ZONE,
      windowStartMs: boise('2026-01-01T00:00:00'),
      windowEndMs: boise('2027-01-01T00:00:00'),
    })
    expect(wallTimes(out)).toEqual([
      '2026-01-15 09:00',
      '2026-04-15 09:00',
      '2026-07-15 09:00',
      '2026-10-15 09:00',
    ])
  })

  it('window bounds are [start, end)', () => {
    const start = boise('2026-01-05T18:00:00')
    const outIncludes = expandTimedRule({
      rruleBody: 'FREQ=DAILY',
      dtstartMs: start,
      timezone: ZONE,
      windowStartMs: start,
      windowEndMs: start + 1,
    })
    expect(outIncludes).toEqual([start])
    const outExcludes = expandTimedRule({
      rruleBody: 'FREQ=DAILY',
      dtstartMs: start,
      timezone: ZONE,
      windowStartMs: start - 24 * 3600_000,
      windowEndMs: start,
    })
    expect(outExcludes).toEqual([])
  })

  it('includes DTSTART even when it does not match the pattern (RFC 5545)', () => {
    // Starts on a Tuesday but repeats on Mondays.
    const out = expandTimedRule({
      rruleBody: 'FREQ=WEEKLY;BYDAY=MO',
      dtstartMs: boise('2026-01-06T10:00:00'), // Tuesday
      timezone: ZONE,
      windowStartMs: boise('2026-01-01T00:00:00'),
      windowEndMs: boise('2026-01-20T00:00:00'),
    })
    expect(wallTimes(out)).toEqual([
      '2026-01-06 10:00', // dtstart itself
      '2026-01-12 10:00',
      '2026-01-19 10:00',
    ])
  })

  it('respects UNTIL', () => {
    const out = expandTimedRule({
      rruleBody: 'FREQ=DAILY;UNTIL=20260110T170000Z', // = 10:00 Boise on Jan 10
      dtstartMs: boise('2026-01-08T10:00:00'),
      timezone: ZONE,
      windowStartMs: boise('2026-01-01T00:00:00'),
      windowEndMs: boise('2026-02-01T00:00:00'),
    })
    expect(wallTimes(out)).toEqual([
      '2026-01-08 10:00',
      '2026-01-09 10:00',
      '2026-01-10 10:00',
    ])
  })
})

describe('computeRecurrenceEnd', () => {
  const dtstart = boise('2026-01-05T18:00:00')
  const oneHour = 3600_000

  it('null for infinite rules', () => {
    expect(computeRecurrenceEnd('FREQ=WEEKLY', dtstart, ZONE, oneHour)).toBeNull()
  })

  it('COUNT: last occurrence start + duration', () => {
    const end = computeRecurrenceEnd('FREQ=DAILY;COUNT=3', dtstart, ZONE, oneHour)
    expect(end).toBe(boise('2026-01-07T18:00:00') + oneHour)
  })

  it('UNTIL: last occurrence start + duration', () => {
    const end = computeRecurrenceEnd('FREQ=DAILY;UNTIL=20260108T023000Z', dtstart, ZONE, oneHour)
    // UNTIL is 2026-01-07 19:30 Boise → last daily 18:00 occurrence is Jan 7.
    expect(end).toBe(boise('2026-01-07T18:00:00') + oneHour)
  })
})

describe('expandDateRule (chores / all-day)', () => {
  it('daily within window', () => {
    expect(expandDateRule({
      rruleBody: 'FREQ=DAILY',
      startDate: '2026-01-01',
      windowStart: '2026-01-03',
      windowEnd: '2026-01-06',
    })).toEqual(['2026-01-03', '2026-01-04', '2026-01-05'])
  })

  it('weekly on Sat', () => {
    expect(expandDateRule({
      rruleBody: 'FREQ=WEEKLY;BYDAY=SA',
      startDate: '2026-01-03',
      windowStart: '2026-01-01',
      windowEnd: '2026-02-01',
    })).toEqual(['2026-01-03', '2026-01-10', '2026-01-17', '2026-01-24', '2026-01-31'])
  })

  it('no DST artifacts: dates are pure strings', () => {
    // Daily across the spring-forward date — every date appears exactly once.
    const out = expandDateRule({
      rruleBody: 'FREQ=DAILY',
      startDate: '2026-03-06',
      windowStart: '2026-03-06',
      windowEnd: '2026-03-11',
    })
    expect(out).toEqual(['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'])
  })

  it('computeDateRecurrenceEnd with COUNT', () => {
    expect(computeDateRecurrenceEnd('FREQ=WEEKLY;COUNT=3', '2026-01-03')).toBe('2026-01-17')
    expect(computeDateRecurrenceEnd('FREQ=WEEKLY', '2026-01-03')).toBeNull()
  })
})

describe('rule truncation (this-and-future splits)', () => {
  it('timed: truncated series ends before the split, none lost or duplicated', () => {
    const dtstart = boise('2026-01-05T18:00:00')
    const splitAt = boise('2026-01-19T18:00:00') // third weekly occurrence
    const truncated = truncateRuleBefore('FREQ=WEEKLY;BYDAY=MO', splitAt)

    const windowStartMs = boise('2026-01-01T00:00:00')
    const windowEndMs = boise('2026-02-10T00:00:00')
    const before = expandTimedRule({ rruleBody: truncated, dtstartMs: dtstart, timezone: ZONE, windowStartMs, windowEndMs })
    const after = expandTimedRule({ rruleBody: 'FREQ=WEEKLY;BYDAY=MO', dtstartMs: splitAt, timezone: ZONE, windowStartMs, windowEndMs })

    expect(wallTimes(before)).toEqual(['2026-01-05 18:00', '2026-01-12 18:00'])
    expect(wallTimes(after)).toEqual(['2026-01-19 18:00', '2026-01-26 18:00', '2026-02-02 18:00', '2026-02-09 18:00'])
    // No overlap between the two halves.
    expect(before.filter(ms => after.includes(ms))).toEqual([])
  })

  it('timed: truncation replaces COUNT with UNTIL', () => {
    const truncated = truncateRuleBefore('FREQ=DAILY;COUNT=100', boise('2026-01-10T08:00:00'))
    expect(truncated).not.toContain('COUNT')
    expect(truncated).toContain('UNTIL=')
  })

  it('date-mode: split on a date', () => {
    const truncated = truncateDateRuleBefore('FREQ=DAILY', '2026-01-10')
    const out = expandDateRule({
      rruleBody: truncated,
      startDate: '2026-01-07',
      windowStart: '2026-01-01',
      windowEnd: '2026-02-01',
    })
    expect(out).toEqual(['2026-01-07', '2026-01-08', '2026-01-09'])
  })
})
