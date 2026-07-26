import { z } from 'zod'
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

export const choreBoardQuerySchema = z.object({
  start: zDateString,
  end: zDateString, // exclusive
})

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
