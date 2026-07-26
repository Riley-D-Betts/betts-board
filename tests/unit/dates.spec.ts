import { DateTime, Settings } from 'luxon'
import { describe, expect, it } from 'vitest'
import { addDaysToDateString, dateStringDiffDays, todayString, toDateString } from '#shared/utils/dates'
import { truncateDateRuleBefore, truncateRuleBefore } from '../../server/services/calendar/recurrence'

/**
 * Guards for the i18n date work.
 *
 * Some dates in this app are *text for people* and some are *keys for
 * machines*. Localising the second kind silently corrupts data — under a
 * locale with a non-Latin numbering system Luxon emits Arabic-Indic digits,
 * which produces unparseable RRULEs and broken .ics exports. These tests fail
 * if a future refactor blurs that line.
 */

describe('calendar date strings stay machine-readable', () => {
  it('todayString and toDateString are plain YYYY-MM-DD', () => {
    expect(todayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(toDateString(new Date(2026, 6, 23))).toBe('2026-07-23')
  })

  it('stay ASCII under a non-Latin numbering locale', () => {
    const previous = Settings.defaultLocale
    try {
      // If anyone ever sets a global Luxon locale, this is what breaks.
      Settings.defaultLocale = 'ar-SA'
      expect(todayString()).toMatch(/^[0-9-]+$/)
      expect(toDateString(new Date(2026, 6, 23))).toBe('2026-07-23')
      expect(addDaysToDateString('2026-07-23', 1)).toBe('2026-07-24')
    }
    finally {
      Settings.defaultLocale = previous
    }
  })

  it('date arithmetic is unaffected by locale', () => {
    expect(addDaysToDateString('2026-12-31', 1)).toBe('2027-01-01')
    expect(dateStringDiffDays('2026-07-24', '2026-07-23')).toBe(1)
  })
})

describe('RRULE UNTIL stays ASCII Gregorian', () => {
  // These build RFC 5545 values. Arabic-Indic digits here produce rules that
  // no calendar client — including our own rrule parser — can read.
  const LOCALES = ['en-US', 'ar-SA', 'fa-IR', 'th-TH']

  it('date-mode truncation emits ASCII digits under every locale', () => {
    const previous = Settings.defaultLocale
    try {
      for (const locale of LOCALES) {
        Settings.defaultLocale = locale
        const rule = truncateDateRuleBefore('FREQ=DAILY', '2026-07-23')
        expect(rule, `locale ${locale}`).toBe('FREQ=DAILY;UNTIL=20260722T235959Z')
      }
    }
    finally {
      Settings.defaultLocale = previous
    }
  })

  it('timed truncation emits ASCII digits under every locale', () => {
    const previous = Settings.defaultLocale
    const at = Date.UTC(2026, 6, 23, 12, 0, 0)
    try {
      for (const locale of LOCALES) {
        Settings.defaultLocale = locale
        const rule = truncateRuleBefore('FREQ=WEEKLY;BYDAY=MO', at)
        expect(rule, `locale ${locale}`).toMatch(/^FREQ=WEEKLY;BYDAY=MO;UNTIL=\d{8}T\d{6}Z$/)
      }
    }
    finally {
      Settings.defaultLocale = previous
    }
  })
})

describe('luxon display formatting is explicitly localised', () => {
  it('formats a time per locale when asked, without a global default', () => {
    const dt = DateTime.fromObject({ year: 2026, month: 7, day: 23, hour: 19, minute: 30 })
    expect(dt.setLocale('en-US').toLocaleString(DateTime.TIME_SIMPLE)).toMatch(/PM/)
    // 24-hour locale renders without an AM/PM marker.
    expect(dt.setLocale('de-DE').toLocaleString(DateTime.TIME_SIMPLE)).toMatch(/19[:.]30/)
  })
})
