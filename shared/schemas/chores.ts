import { z } from 'zod'
import { dateStringDiffDays } from '../utils/dates'
import { zDateString, zEmoji, zId, zRRule, zTimeString } from './common'

export const choreCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullish(),
  emoji: zEmoji.nullish(),
  points: z.number().int().min(0).max(1000).default(1),
  rrule: zRRule.nullish(), // null = one-off on startDate
  startDate: zDateString,
  dueTime: zTimeString.nullish(),
  recurrenceEnd: zDateString.nullish(),
  /** Missed occurrences pile up per day (true) or merge into one (false). */
  stacking: z.boolean().default(false),
  assigneeProfileIds: z.array(zId).min(1),
})

export const chorePatchSchema = choreCreateSchema.partial().extend({
  archived: z.boolean().optional(),
})

export const choreCompleteSchema = z.object({
  dueDate: zDateString,
  profileId: zId,
})

/**
 * The widest board `/api/chores/board` will build, in days.
 *
 * Same rule, same reason, as MAX_CALENDAR_WINDOW_DAYS in ./events: the board
 * expands every active chore across the window and then multiplies by every
 * assignee, so `?start=0001-01-01&end=9999-12-31` turned twenty daily chores
 * and four kids into 400,000 instances — a ~112 MB response — inside the one
 * container the whole household shares. The screens ask for a day (the tile
 * and the TV) or a week (the chores page), so a year is generous.
 */
export const MAX_CHORE_BOARD_WINDOW_DAYS = 366

export const choreBoardQuerySchema = z.object({
  start: zDateString,
  end: zDateString, // exclusive
}).refine(q => dateStringDiffDays(q.end, q.start) <= MAX_CHORE_BOARD_WINDOW_DAYS,
  `window must be at most ${MAX_CHORE_BOARD_WINDOW_DAYS} days`)

export const leaderboardQuerySchema = z.object({
  period: z.enum(['week', 'month', 'all']).default('week'),
})

export type ChoreCreate = z.infer<typeof choreCreateSchema>

/** One expanded chore instance for one assignee on one date. */
export interface ChoreInstance {
  choreId: string
  title: string
  emoji?: string | null
  points: number
  dueDate: string
  dueTime?: string | null
  profileId: string
  profileName: string
  profileColor: string
  completed: boolean
  completedAt?: number | null
  hasRecurrence: boolean
  /** Rolled over from a missed earlier day; dueDate is the original date. */
  overdue?: boolean
  daysLate?: number
}

export interface LeaderboardRow {
  profileId: string
  name: string
  color: string
  points: number
  completedCount: number
  currentStreak: number // consecutive expected-days completed, per best chore
}
