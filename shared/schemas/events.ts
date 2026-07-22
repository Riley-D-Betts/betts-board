import { z } from 'zod'
import { zDateString, zEpochMs, zHexColor, zIanaTimezone, zId, zRRule } from './common'

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

export const calendarQuerySchema = z.object({
  start: z.coerce.number().int(), // window [start, end) as epoch ms
  end: z.coerce.number().int(),
  profileIds: z.string().optional(), // comma-separated filter
  includeChores: z.coerce.boolean().default(false),
})

export const feedCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().url().max(2000),
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
