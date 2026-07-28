import { z } from 'zod'
import { zDateString, zEpochMs, zHexColor, zHttpUrl, zIanaTimezone, zId, zRRule } from './common'

const eventBase = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullish(),
  location: z.string().max(500).nullish(),
  isAllDay: z.boolean().default(false),
  // Timed events use startAt/endAt (UTC ms); all-day use startDate/endDate
  // (endDate exclusive). Exactly one pair must be present — see refinement.
  startAt: zEpochMs.nullish(),
  endAt: zEpochMs.nullish(),
  startDate: zDateString.nullish(),
  endDate: zDateString.nullish(),
  timezone: zIanaTimezone,
  rrule: zRRule.nullish(),
  reminderMinutes: z.array(z.number().int().min(0).max(40320)).max(5).nullish(),
  color: zHexColor.nullish(),
  attendeeProfileIds: z.array(zId).default([]),
})

function refineEventTimes<T extends z.ZodType<z.infer<typeof eventBase>>>(schema: T) {
  return schema
    .refine(e => e.isAllDay ? (e.startDate && e.endDate) : (e.startAt != null && e.endAt != null),
      'all-day events need startDate/endDate; timed events need startAt/endAt')
    .refine(e => e.isAllDay ? (e.endDate! > e.startDate!) : (e.endAt! > e.startAt!),
      'event must end after it starts')
}

export const eventCreateSchema = refineEventTimes(eventBase)

/** Which occurrences an edit/delete applies to when the event recurs. */
export const scopeSchema = z.object({
  scope: z.enum(['all', 'this', 'future']).default('all'),
  /** Original occurrence instant (ms) — required for scope 'this'/'future'. */
  occurrenceStart: zEpochMs.optional(),
}).refine(s => s.scope === 'all' || s.occurrenceStart != null,
  'occurrenceStart is required for scope "this" or "future"')

export const eventPatchSchema = z.object({
  scope: z.enum(['all', 'this', 'future']).default('all'),
  occurrenceStart: zEpochMs.optional(),
  changes: eventBase.partial(),
}).refine(s => s.scope === 'all' || s.occurrenceStart != null,
  'occurrenceStart is required for scope "this" or "future"')

export const eventDeleteSchema = scopeSchema

/**
 * The widest window `/api/calendar` will expand, in days.
 *
 * `start`/`end` used to be any two integers, so `?start=0&end=99999999999999`
 * asked one container — the one the whole household shares — to expand every
 * occurrence of every daily series for three thousand years. The screens never
 * need more: the month grid asks for 42 days and the agenda for 30, so a year
 * still leaves room for a year view or a bulk export without argument.
 */
export const MAX_CALENDAR_WINDOW_DAYS = 366
const MAX_CALENDAR_WINDOW_MS = MAX_CALENDAR_WINDOW_DAYS * 86_400_000

/**
 * An instant a JS Date can actually represent. Past ±8.64e15 every date
 * computation quietly yields Invalid Date, which reaches SQL as null and
 * NaN — a wrong answer rather than a loud failure.
 */
const zWindowInstant = z.coerce.number().int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000)

export const calendarQuerySchema = z.object({
  start: zWindowInstant, // window [start, end) as epoch ms
  end: zWindowInstant,
  // Comma-separated filter. Bounded because the filter is applied per
  // occurrence in JS: an unbounded id list makes one GET quadratic.
  profileIds: z.string().max(1000).optional(),
  includeChores: z.coerce.boolean().default(false),
})
  .refine(q => q.end > q.start, 'end must be after start')
  .refine(q => q.end - q.start <= MAX_CALENDAR_WINDOW_MS,
    `window must be at most ${MAX_CALENDAR_WINDOW_DAYS} days`)

/**
 * A calendar subscription URL.
 *
 * The refresh task fetches this every `fetchIntervalMinutes` from inside the
 * container. `z.string().url()` would have let an admin point a "calendar
 * feed" at `file:///data/board.db` and read the answer back through the
 * calendar, so the scheme is pinned to http(s).
 *
 * `webcal://` survives that pinning by being rewritten first. It is not a
 * separate transport — it is https with a hint to open a calendar app — and it
 * is what iCloud, Outlook and most school districts hand out, what this app's
 * own subscribe box offers to copy, and what the field's placeholder promises
 * in all three locales ("https://… or webcal://… .ics URL"). Refusing it would
 * break the single most common way a family adds a school calendar.
 *
 * Rewritten rather than merely allowed, so the stored column is always http(s)
 * and every later reader — the refresh task, safeFetch, anything added next —
 * can trust it without repeating this step. `normalizeFeedUrl()` in
 * server/services/ics/import.ts still runs at fetch time, for rows saved
 * before this validator existed.
 */
const zFeedUrl = z.string().trim().max(2000)
  .transform(value => value.replace(/^webcal:\/\//i, 'https://'))
  .pipe(zHttpUrl.max(2000))

export const feedCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: zFeedUrl,
  color: zHexColor.default('#64748b'),
  fetchIntervalMinutes: z.number().int().min(15).max(1440).default(60),
})

export const feedPatchSchema = feedCreateSchema.partial().extend({
  enabled: z.boolean().optional(),
})

export type EventCreate = z.infer<typeof eventCreateSchema>
export type EventPatch = z.infer<typeof eventPatchSchema>

/** Expanded occurrence DTO returned by /api/calendar. */
export interface CalendarOccurrence {
  occurrenceId: string // `${eventId}:${originalStartMs}` — stable edit key
  eventId: string
  kind: 'event' | 'feed' | 'chore' | 'meal'
  /**
   * The subject only, never a label: a `meal` occurrence carries the DISH, and
   * the screen composes "Cooking — {title}" from `kind` in the board's
   * language. Render it through `useOccurrenceTitle()` rather than raw.
   */
  title: string
  description?: string | null
  location?: string | null
  isAllDay: boolean
  start: number // epoch ms (all-day: local midnight in household tz)
  end: number
  startDate?: string // present for all-day occurrences
  endDate?: string
  color: string
  attendees: { profileId: string, color: string, name: string }[]
  readonly: boolean // true for feed events
  isException: boolean
  hasRecurrence: boolean
  feedId?: string | null
  choreId?: string | null
  dueDate?: string // chores only
  mealEntryId?: string | null // cooking blocks only
  recipeId?: string | null // cooking blocks only
}
