import { z } from 'zod'

/** YYYY-MM-DD local calendar date — never timezone-converted. */
export const zDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

/** HH:MM 24h wall time. */
export const zTimeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM')

export const zHexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb')

/** UTC instant as epoch milliseconds. */
export const zEpochMs = z.number().int().nonnegative()

export const zId = z.string().min(1)

/** Bare RRULE body, e.g. "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE" (no DTSTART line). */
export const zRRule = z.string().regex(/^FREQ=/, 'expected an RRULE body starting with FREQ=')

export const zIanaTimezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  }
  catch {
    return false
  }
}, 'unknown IANA timezone')
