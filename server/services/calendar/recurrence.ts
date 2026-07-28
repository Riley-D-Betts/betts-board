import { RRule } from 'rrule'
import type { Options } from 'rrule'
import { DateTime } from 'luxon'
import { RRULE_FREQUENCIES } from '#shared/schemas/common'
import { machineFormat } from '#shared/utils/machineFormat'

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

/**
 * Hard ceiling on the occurrences ONE series may produce in ONE expansion.
 *
 * The window schema caps the span a caller may ask for, but this cap is what
 * survives a rule the schema never saw: rows written before `zRRule` learned
 * to reject sub-hourly frequencies, and RRULEs imported wholesale from an ICS
 * feed somebody else publishes. A year of "every 5 minutes" is 105,000
 * occurrences; expanded for a handful of events that is the container's
 * memory. rrule takes the limit as an iteration callback, so the occurrences
 * past the cap are never generated at all — slicing afterwards would have
 * spent exactly the memory this is protecting.
 */
export const MAX_OCCURRENCES_PER_SERIES = 5000

/** The FREQ values the expander will iterate, as rrule's numeric enum. */
const EXPANDABLE_FREQUENCIES = new Set<number>(RRULE_FREQUENCIES.map(name => RRule[name]))

/**
 * Ceiling on the times-of-day ONE period of a rule may expand to.
 *
 * FREQ is not the only way to ask for a sub-hourly series. BYHOUR, BYMINUTE
 * and BYSECOND MULTIPLY inside every period, so `FREQ=DAILY` — a frequency
 * this module allows, and one `zRRule` accepts — becomes 86,400 occurrences a
 * day when all three are listed in full. rrule has to build every one of them
 * on its way from DTSTART to the window, so the count limit (which only ever
 * sees occurrences that land INSIDE the window) never gets a chance to fire.
 * Measured on this machine, one such rule with a 2020 DTSTART cost 113s of
 * blocked CPU for a ONE-DAY window in 2026 — the same outage FREQ=SECONDLY
 * used to cause, reached through a frequency the schema allows.
 *
 * 48 keeps everything a calendar really publishes: BYHOUR with all 24 hours,
 * or 24 hours at half-past as well. It refuses 1,440/day and 86,400/day, and
 * caps the walk from a 1970 DTSTART at about a million steps.
 */
export const MAX_TIMES_OF_DAY_PER_PERIOD = 48

/** How many wall-clock times each period of the rule expands to. */
function timesOfDayPerPeriod(options: Partial<Options>): number {
  // rrule's parser yields a bare number for one value and an array for a list.
  const count = (part: number | number[] | null | undefined) =>
    Array.isArray(part) ? Math.max(1, part.length) : 1
  return count(options.byhour) * count(options.byminute) * count(options.bysecond)
}

/**
 * Whether this rule may be handed to rrule's iterator at all.
 *
 * A count limit alone is not enough protection. rrule walks from DTSTART one
 * step at a time, so it does the work of reaching the requested window before
 * it can yield the first occurrence a caller sees: "FREQ=SECONDLY" with a
 * DTSTART a few years back is hundreds of millions of steps for a window in
 * 2026, and a single calendar GET pins the CPU for minutes. `zRRule` rejects
 * those on the way in, but stored rows are never re-validated and ICS feeds
 * import whatever a stranger wrote. A rule we refuse to iterate degrades to
 * its DTSTART occurrence — visible in the calendar, and bounded.
 */
function isExpandableRule(options: Partial<Options>): boolean {
  return options.freq != null
    && EXPANDABLE_FREQUENCIES.has(options.freq)
    // INTERVAL=0 is not a valid rule; rrule iterates it without advancing.
    && (options.interval ?? 1) >= 1
    && timesOfDayPerPeriod(options) <= MAX_TIMES_OF_DAY_PER_PERIOD
}

/** Parse a bare RRULE body ("FREQ=…", no DTSTART) into rrule options. */
function parseBody(rruleBody: string) {
  return RRule.parseString(rruleBody.startsWith('RRULE:') ? rruleBody : `RRULE:${rruleBody}`)
}

/** The iterable rule, or null when the body is one we refuse to expand. */
function buildRule(rruleBody: string, naiveDtstart: Date, timezone?: string): RRule | null {
  const options = parseBody(rruleBody)
  if (!isExpandableRule(options)) return null
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
  /** Lower this when a shared budget is nearly spent; it can never be raised
   * above MAX_OCCURRENCES_PER_SERIES. */
  limit?: number
}

/** Occurrences the caller asked for, clamped to the cap this module enforces. */
function effectiveLimit(limit: number | undefined): number {
  return Math.max(0, Math.min(limit ?? MAX_OCCURRENCES_PER_SERIES, MAX_OCCURRENCES_PER_SERIES))
}

/** Expand a timed recurring series to occurrence start instants (epoch ms). */
export function expandTimedRule(args: ExpandTimedArgs): number[] {
  const { rruleBody, dtstartMs, timezone, windowStartMs, windowEndMs } = args
  const limit = effectiveLimit(args.limit)
  const wallStart = DateTime.fromMillis(dtstartMs, { zone: timezone })
  const rule = buildRule(rruleBody, toNaive(wallStart), timezone)

  // Widen the naive window by a day on each side: converting the window edges
  // between zones can shift occurrences across the boundary.
  const naiveW1 = toNaive(DateTime.fromMillis(windowStartMs, { zone: timezone }).minus({ days: 1 }))
  const naiveW2 = toNaive(DateTime.fromMillis(windowEndMs, { zone: timezone }).plus({ days: 1 }))

  // The 4th argument stops the ITERATION at the cap — rrule never builds the
  // occurrences beyond it.
  const instants = (rule?.between(naiveW1, naiveW2, true, (_, i) => i < limit) ?? [])
    .map(naive => fromNaive(naive, timezone).toMillis())

  // RFC 5545: DTSTART is always the first occurrence, even when it doesn't
  // match the pattern (the rrule package omits it in that case). It is also
  // the ONLY occurrence of a rule we refuse to iterate — see isExpandableRule.
  // Skipped once the cap is reached, so the cap is a true ceiling.
  if (instants.length < limit && dtstartMs >= windowStartMs && dtstartMs < windowEndMs
    && !instants.includes(dtstartMs)) {
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
  /** See ExpandTimedArgs.limit. */
  limit?: number
}

/** Expand a date-based series (all-day events, chores). No timezones at all. */
export function expandDateRule(args: ExpandDateArgs): string[] {
  const { rruleBody, startDate, windowStart, windowEnd } = args
  const limit = effectiveLimit(args.limit)
  const naiveStart = dateStringToNaive(startDate)
  const rule = buildRule(rruleBody, naiveStart)

  const dates = (rule?.between(
    dateStringToNaive(windowStart), dateStringToNaive(windowEnd), true, (_, i) => i < limit,
  ) ?? [])
    .map(naiveToDateString)
    // `between` is instant-inclusive at the end bound; the window end date is exclusive.
    .filter(d => d < windowEnd)

  if (dates.length < limit && startDate >= windowStart && startDate < windowEnd
    && !dates.includes(startDate)) {
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
  // A rule the expander refuses to iterate shows only its DTSTART, so that is
  // where the series ends. Keeping this in step with the expander matters:
  // recurrenceEnd is what the window query prunes on.
  if (!isExpandableRule(options)) return dtstartMs + durationMs
  if (!options.until && !options.count) return null
  if (options.count && options.count > COUNT_SCAN_LIMIT) return null

  const wallStart = DateTime.fromMillis(dtstartMs, { zone: timezone })
  const rule = buildRule(rruleBody, toNaive(wallStart), timezone)!
  const all = rule.all((_, i) => i < COUNT_SCAN_LIMIT)
  const lastNaive = all[all.length - 1]
  if (!lastNaive) return dtstartMs + durationMs // rule yields nothing beyond dtstart
  const lastMs = fromNaive(lastNaive, timezone).toMillis()
  return Math.max(lastMs, dtstartMs) + durationMs
}

/** Date-mode version: last due date of the series, or null when infinite. */
export function computeDateRecurrenceEnd(rruleBody: string, startDate: string): string | null {
  const options = parseBody(rruleBody)
  if (!isExpandableRule(options)) return startDate // see computeRecurrenceEnd
  if (!options.until && !options.count) return null
  if (options.count && options.count > COUNT_SCAN_LIMIT) return null

  const rule = buildRule(rruleBody, dateStringToNaive(startDate))!
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
  parts.push(`UNTIL=${machineFormat(untilUtc, "yyyyMMdd'T'HHmmss'Z'")}`)
  return parts.join(';')
}

/** Date-mode truncation: series ends strictly before the given date. */
export function truncateDateRuleBefore(rruleBody: string, beforeDate: string): string {
  const parts = rruleBody
    .replace(/^RRULE:/, '')
    .split(';')
    .filter(p => !/^(UNTIL|COUNT)=/i.test(p))
  const prevDay = machineFormat(DateTime.fromISO(beforeDate).minus({ days: 1 }), 'yyyyMMdd')
  parts.push(`UNTIL=${prevDay}T235959Z`)
  return parts.join(';')
}
