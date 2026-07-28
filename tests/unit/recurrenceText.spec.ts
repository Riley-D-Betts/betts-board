import { describe, expect, it } from 'vitest'
import { describeRecurrence } from '#shared/utils/recurrenceText'

/**
 * The RRULE→descriptor mapping. Pure, so the parsing edge cases are tested
 * without any i18n or Vue in the way — which is the whole reason the sentence
 * building was moved out of this file.
 */

describe('describeRecurrence', () => {
  it('describes no rule at all', () => {
    expect(describeRecurrence(null)).toEqual({ key: 'none', params: {} })
    expect(describeRecurrence('')).toEqual({ key: 'none', params: {} })
  })

  it.each([
    ['FREQ=DAILY', 'daily', {}],
    ['FREQ=DAILY;INTERVAL=3', 'dailyEvery', { n: 3 }],
    ['FREQ=WEEKLY', 'weekly', {}],
    ['FREQ=WEEKLY;INTERVAL=2', 'weeklyEvery', { n: 2 }],
    ['FREQ=MONTHLY', 'monthly', {}],
    ['FREQ=MONTHLY;INTERVAL=3', 'quarterly', { n: 3 }],
    ['FREQ=MONTHLY;INTERVAL=6', 'monthlyEvery', { n: 6 }],
    ['FREQ=YEARLY', 'yearly', {}],
    ['FREQ=YEARLY;INTERVAL=2', 'yearlyEvery', { n: 2 }],
  ])('%s → %s', (rrule, key, params) => {
    const d = describeRecurrence(rrule)
    expect(d.key).toBe(key)
    expect(d.params).toEqual(params)
  })

  it('carries weekdays separately rather than baking them into a phrase', () => {
    const d = describeRecurrence('FREQ=WEEKLY;BYDAY=MO,WE')
    expect(d.key).toBe('weeklyOn')
    expect(d.weekdays).toEqual(['MO', 'WE'])
  })

  it('keeps the interval and the weekdays together', () => {
    const d = describeRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR')
    expect(d.key).toBe('weeklyEveryOn')
    expect(d.params).toEqual({ n: 2 })
    expect(d.weekdays).toEqual(['MO', 'WE', 'FR'])
  })

  it('strips the ordinal prefix from a positional BYDAY', () => {
    // "the 2nd Monday" — the ordinal itself is not described, but the day is,
    // which is better than printing "2MO" at somebody.
    expect(describeRecurrence('FREQ=MONTHLY;BYDAY=2MO').weekdays).toEqual(['MO'])
    expect(describeRecurrence('FREQ=MONTHLY;BYDAY=-1FR').weekdays).toEqual(['FR'])
  })

  it('describes a monthly day-of-month rule', () => {
    expect(describeRecurrence('FREQ=MONTHLY;BYMONTHDAY=15'))
      .toMatchObject({ key: 'monthlyOnDay', params: { day: '15' } })
    expect(describeRecurrence('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1'))
      .toMatchObject({ key: 'quarterlyOnDay', params: { n: 3, day: '1' } })
  })

  it('wraps a COUNT as a suffix frame, so the language owns the word order', () => {
    const d = describeRecurrence('FREQ=WEEKLY;COUNT=10')
    expect(d.key).toBe('weekly')
    expect(d.suffix).toEqual({ key: 'times', params: { n: 10 } })
  })

  it('renders UNTIL as a calendar date, never through a locale formatter', () => {
    const d = describeRecurrence('FREQ=WEEKLY;UNTIL=20261231T235959Z')
    expect(d.suffix).toEqual({ key: 'until', params: { date: '2026-12-31' } })
  })

  it('prefers COUNT over UNTIL when a rule carries both', () => {
    const d = describeRecurrence('FREQ=DAILY;COUNT=5;UNTIL=20261231T000000Z')
    expect(d.suffix?.key).toBe('times')
  })

  it('shows an unrecognised rule verbatim rather than inventing a description', () => {
    const d = describeRecurrence('FREQ=HOURLY;INTERVAL=6')
    expect(d.raw).toBe('FREQ=HOURLY;INTERVAL=6')
  })

  it('reads lowercase and mixed-case rules', () => {
    expect(describeRecurrence('freq=weekly;interval=2').key).toBe('weeklyEvery')
  })

  it('ignores a malformed UNTIL rather than slicing nonsense out of it', () => {
    expect(describeRecurrence('FREQ=DAILY;UNTIL=2026').suffix).toBeUndefined()
  })
})
