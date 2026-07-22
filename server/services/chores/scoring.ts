import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { LeaderboardRow } from '#shared/schemas/chores'
import { addDaysToDateString, parseDateString } from '#shared/utils/dates'
import type { Db } from '../../db/client'
import { choreAssignees, choreCompletions, choreExceptions, chores, households, profiles } from '../../db/schema'
import { expandDateRule } from '../calendar/recurrence'

export type LeaderboardPeriod = 'week' | 'month' | 'all'

export interface LeaderboardArgs {
  householdId: string
  period: LeaderboardPeriod
  /** Override "today" (YYYY-MM-DD) for tests; defaults to today in the household timezone. */
  today?: string
}

/** [start, end) date-string bounds for a period, or null = unbounded ('all'). */
export function periodBounds(period: LeaderboardPeriod, today: string, weekStartsOn: 0 | 1): { start: string, end: string } | null {
  if (period === 'all') return null
  if (period === 'week') {
    const dow = parseDateString(today).getDay() // 0 = Sunday
    const start = addDaysToDateString(today, -((dow - weekStartsOn + 7) % 7))
    return { start, end: addDaysToDateString(start, 7) }
  }
  const [y, m] = today.split('-').map(Number) as [number, number]
  const start = `${today.slice(0, 8)}01`
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { start, end }
}

export function getLeaderboard(db: Db, args: LeaderboardArgs): LeaderboardRow[] {
  const hh = db.select().from(households).where(eq(households.id, args.householdId)).get()
  if (!hh) return []
  const today = args.today ?? DateTime.now().setZone(hh.timezone).toISODate()!
  const bounds = periodBounds(args.period, today, hh.settings.weekStartsOn)

  const members = db.select().from(profiles)
    .where(and(eq(profiles.householdId, args.householdId), isNull(profiles.archivedAt)))
    .all()
  if (members.length === 0) return []

  // Completions in the period (archived chores' history still counts).
  const completions = db.select({
    profileId: choreCompletions.profileId,
    pointsAwarded: choreCompletions.pointsAwarded,
  }).from(choreCompletions)
    .innerJoin(chores, eq(chores.id, choreCompletions.choreId))
    .where(and(
      eq(chores.householdId, args.householdId),
      ...(bounds
        ? [gte(choreCompletions.dueDate, bounds.start), lt(choreCompletions.dueDate, bounds.end)]
        : []),
    ))
    .all()

  const totals = new Map<string, { points: number, count: number }>()
  for (const c of completions) {
    const t = totals.get(c.profileId) ?? { points: 0, count: 0 }
    t.points += c.pointsAwarded
    t.count += 1
    totals.set(c.profileId, t)
  }

  // Streaks run over active chores only.
  const assignments = db.select({ choreId: choreAssignees.choreId, profileId: choreAssignees.profileId })
    .from(choreAssignees)
    .innerJoin(chores, eq(chores.id, choreAssignees.choreId))
    .where(and(eq(chores.householdId, args.householdId), isNull(chores.archivedAt)))
    .all()

  return members.map((p) => {
    const t = totals.get(p.id) ?? { points: 0, count: 0 }
    const currentStreak = assignments
      .filter(a => a.profileId === p.id)
      .reduce((best, a) => Math.max(best, getCurrentStreak(db, { choreId: a.choreId, profileId: p.id, today })), 0)
    return {
      profileId: p.id,
      name: p.name,
      color: p.color,
      points: t.points,
      completedCount: t.count,
      currentStreak,
    }
  }).sort((a, b) => b.points - a.points || b.completedCount - a.completedCount || a.name.localeCompare(b.name))
}

export interface StreakArgs {
  choreId: string
  profileId: string
  today: string // YYYY-MM-DD
}

/**
 * Consecutive expected due-dates completed, walking backward from today.
 * An incomplete TODAY is skipped (the day isn't over), never breaks the streak.
 */
export function getCurrentStreak(db: Db, args: StreakArgs): number {
  const chore = db.select().from(chores).where(eq(chores.id, args.choreId)).get()
  if (!chore) return 0

  const windowStart = addDaysToDateString(args.today, -365)
  const windowEnd = addDaysToDateString(args.today, 1) // exclusive → includes today

  const skipped = new Set(
    db.select().from(choreExceptions)
      .where(eq(choreExceptions.choreId, args.choreId)).all()
      .map(x => x.dueDate),
  )

  const expected = (chore.rrule
    ? expandDateRule({
        rruleBody: chore.rrule,
        startDate: chore.startDate,
        windowStart,
        windowEnd,
      })
    : [chore.startDate].filter(d => d >= windowStart && d < windowEnd)
  ).filter(d => !skipped.has(d))
  if (expected.length === 0) return 0

  const completed = new Set(
    db.select({ dueDate: choreCompletions.dueDate }).from(choreCompletions)
      .where(and(
        eq(choreCompletions.choreId, args.choreId),
        eq(choreCompletions.profileId, args.profileId),
        inArray(choreCompletions.dueDate, expected),
      )).all()
      .map(c => c.dueDate),
  )

  let streak = 0
  for (let i = expected.length - 1; i >= 0; i--) {
    const date = expected[i]!
    if (completed.has(date)) {
      streak += 1
    }
    else if (date === args.today) {
      continue // today isn't over yet
    }
    else {
      break
    }
  }
  return streak
}
