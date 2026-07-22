import { RRule } from 'rrule'
import { DateTime } from 'luxon'

/**
 * The ONLY module that touches the `rrule` package.
 *
 * The rrule library computes in a "naive" datetime space: JS Dates whose UTC
 * fields are treated as local wall-clock values. We convert real instants to
 * wall time in the event's authored timezone, run rrule in naive space, then
 * map each naive occurrence back to a real instant with Luxon. That mapping is
 * what makes DST correct: a 7:00 AM weekly event stays 7:00 AM local across
 * spring-forward/fall-back. Luxon resolves nonexistent wall times (the
 * spring-forward gap) forward, which is the sane default.
 */

/** Wall-clock DateTime → naive Date (UTC fields carry the wall values). */
function toNaive(dt: DateTime): Date {
  return new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second))
}

/** Naive Date → real instant in the given zone. */
function fromNaive(d: Date, zone: string): DateTime {
  return DateTime.fromObject({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  }, { zone })
}

/** Parse a bare RRULE body ("FREQ=…", no DTSTART) into rrule options. */
function parseBody(rruleBody: string) {
  return RRule.parseString(rruleBody.startsWith('RRULE:') ? rruleBody : `RRULE:${rruleBody}`)
}

function buildRule(rruleBody: string, naiveDtstart: Date, timezone?: string) {
  const options = parseBody(rruleBody)
  if (options.until) {
    // RFC 5545: UNTIL is a UTC instant. Convert to naive wall time in the
    // event zone so it compares correctly in rrule's naive space.
    const until = timezone
      ? toNaive(DateTime.fromJSDate(options.until, { zone: 'utc' }).setZone(timezone))
      : options.until // date-mode: already a naive date
    options.until = until
  }
  return new RRule({ ...options, dtstart: naiveDtstart })
}

export interface ExpandTimedArgs {
  rruleBody: string
  dtstartMs: number // real instant of the series start
  timezone: string // IANA zone the event was authored in
  windowStartMs: number // [start, end)
  windowEndMs: number
}

/** Expand a timed recurring series to occurrence start instants (epoch ms). */
export function expandTimedRule(args: ExpandTimedArgs): number[] {
  const { rruleBody, dtstartMs, timezone, windowStartMs, windowEndMs } = args
  const wallStart = DateTime.fromMillis(dtstartMs, { zone: timezone })
  const rule = buildRule(rruleBody, toNaive(wallStart), timezone)

  // Widen the naive window by a day on each side: converting the window edges
  // between zones can shift occurrences across the boundary.
  const naiveW1 = toNaive(DateTime.fromMillis(windowStartMs, { zone: timezone }).minus({ days: 1 }))
  const naiveW2 = toNaive(DateTime.fromMillis(windowEndMs, { zone: timezone }).plus({ days: 1 }))

  const instants = rule.between(naiveW1, naiveW2, true)
    .map(naive => fromNaive(naive, timezone).toMillis())

  // RFC 5545: DTSTART is always the first occurrence, even when it doesn't
  // match the pattern (the rrule package omits it in that case).
  if (dtstartMs >= windowStartMs && dtstartMs < windowEndMs && !instants.includes(dtstartMs)) {
    instants.push(dtstartMs)
  }

  return instants
    .filter(ms => ms >= windowStartMs && ms < windowEndMs)
    .sort((a, b) => a - b)
}

export interface ExpandDateArgs {
  rruleBody: string
  startDate: string // YYYY-MM-DD
  windowStart: string // inclusive
  windowEnd: string // exclusive
}

/** Expand a date-based series (all-day events, chores). No timezones at all. */
export function expandDateRule(args: ExpandDateArgs): string[] {
  const { rruleBody, startDate, windowStart, windowEnd } = args
  const naiveStart = dateStringToNaive(startDate)
  const rule = buildRule(rruleBody, naiveStart)

  const dates = rule
    .between(dateStringToNaive(windowStart), dateStringToNaive(windowEnd), true)
    .map(naiveToDateString)
    // `between` is instant-inclusive at the end bound; the window end date is exclusive.
    .filter(d => d < windowEnd)

  if (startDate >= windowStart && startDate < windowEnd && !dates.includes(startDate)) {
    dates.push(startDate)
  }
  return dates.filter(d => d >= windowStart).sort()
}

function dateStringToNaive(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!))
}

function naiveToDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Occurrences beyond this are treated as "repeats forever". */
const COUNT_SCAN_LIMIT = 5000

/**
 * Last visible instant of a timed series (last occurrence start + duration),
 * or null when it repeats forever. Denormalized into events.recurrenceEnd at
 * write time so the calendar window query stays index-friendly.
 */
export function computeRecurrenceEnd(
  rruleBody: string,
  dtstartMs: number,
  timezone: string,
  durationMs: number,
): number | null {
  const options = parseBody(rruleBody)
  if (!options.until && !options.count) return null
  if (options.count && options.count > COUNT_SCAN_LIMIT) return null

  const wallStart = DateTime.fromMillis(dtstartMs, { zone: timezone })
  const rule = buildRule(rruleBody, toNaive(wallStart), timezone)
  const all = rule.all((_, i) => i < COUNT_SCAN_LIMIT)
  const lastNaive = all[all.length - 1]
  if (!lastNaive) return dtstartMs + durationMs // rule yields nothing beyond dtstart
  const lastMs = fromNaive(lastNaive, timezone).toMillis()
  return Math.max(lastMs, dtstartMs) + durationMs
}

/** Date-mode version: last due date of the series, or null when infinite. */
export function computeDateRecurrenceEnd(rruleBody: string, startDate: string): string | null {
  const options = parseBody(rruleBody)
  if (!options.until && !options.count) return null
  if (options.count && options.count > COUNT_SCAN_LIMIT) return null

  const rule = buildRule(rruleBody, dateStringToNaive(startDate))
  const all = rule.all((_, i) => i < COUNT_SCAN_LIMIT)
  const last = all[all.length - 1]
  return last ? naiveToDateString(last) : startDate
}

/**
 * Truncate an RRULE body so the series ends strictly BEFORE the given instant.
 * Used by "edit this and all future": the master keeps everything before the
 * split occurrence, the new master takes over from it. Returns the new body.
 */
export function truncateRuleBefore(rruleBody: string, beforeMs: number): string {
  const options = parseBody(rruleBody)
  // Replacing COUNT with UNTIL is the standard split behavior (Google does the
  // same): keeping COUNT on the truncated master would change its meaning.
  delete options.count
  const untilUtc = DateTime.fromMillis(beforeMs - 1000, { zone: 'utc' })
  const parts = rruleBody
    .replace(/^RRULE:/, '')
    .split(';')
    .filter(p => !/^(UNTIL|COUNT)=/i.test(p))
  parts.push(`UNTIL=${untilUtc.toFormat("yyyyMMdd'T'HHmmss'Z'")}`)
  return parts.join(';')
}

/** Date-mode truncation: series ends strictly before the given date. */
export function truncateDateRuleBefore(rruleBody: string, beforeDate: string): string {
  const parts = rruleBody
    .replace(/^RRULE:/, '')
    .split(';')
    .filter(p => !/^(UNTIL|COUNT)=/i.test(p))
  const prevDay = DateTime.fromISO(beforeDate).minus({ days: 1 }).toFormat('yyyyMMdd')
  parts.push(`UNTIL=${prevDay}T235959Z`)
  return parts.join(';')
}
