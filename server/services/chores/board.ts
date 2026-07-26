import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { createError } from 'h3'
import type { ChoreInstance } from '#shared/schemas/chores'
import { addDaysToDateString, dateStringDiffDays } from '#shared/utils/dates'
import type { Db } from '../../db/client'
import { choreAssignees, choreCompletions, choreExceptions, chores, profiles } from '../../db/schema'
import { expandDateRule } from '../calendar/recurrence'
import { getCurrentStreak } from './scoring'

/** Missed occurrences older than this never roll forward. */
export const ROLLOVER_LOOKBACK_DAYS = 30

export interface ChoreBoardArgs {
  householdId: string
  startDate: string // inclusive, YYYY-MM-DD
  endDate: string // exclusive, YYYY-MM-DD
  /** Today in the household timezone (YYYY-MM-DD). When it falls inside the
   * window, missed past occurrences roll forward and attach to today as
   * overdue instances: stacking chores emit one per missed day, non-stacking
   * chores merge into a single instance for the most recent miss. */
  today?: string
}

/**
 * Expand every active chore into per-assignee instances inside
 * [startDate, endDate), plus rollover instances under `today` when given.
 */
export function getChoreBoard(db: Db, args: ChoreBoardArgs): ChoreInstance[] {
  const { householdId, startDate, endDate } = args
  const today = args.today && args.today >= startDate && args.today < endDate ? args.today : null
  const lookbackStart = today ? addDaysToDateString(today, -ROLLOVER_LOOKBACK_DAYS) : null

  const candidates = db.select().from(chores).where(and(
    eq(chores.householdId, householdId),
    isNull(chores.archivedAt),
    lt(chores.startDate, endDate), // series can't occur before it starts
  )).all().filter((c) => {
    // recurring: series not over before the window; one-off: startDate in window
    if (c.rrule ? (c.recurrenceEnd == null || c.recurrenceEnd >= startDate) : c.startDate >= startDate) return true
    // rollover can resurrect a chore whose last occurrence is inside the lookback
    return lookbackStart != null
      && (c.rrule ? c.recurrenceEnd! >= lookbackStart : c.startDate >= lookbackStart)
  })
  if (candidates.length === 0) return []
  const ids = candidates.map(c => c.id)

  const skipped = new Set(
    db.select().from(choreExceptions)
      .where(inArray(choreExceptions.choreId, ids)).all()
      .map(x => `${x.choreId}:${x.dueDate}`),
  )

  const assigneeRows = db.select({
    choreId: choreAssignees.choreId,
    profileId: profiles.id,
    profileName: profiles.name,
    profileColor: profiles.color,
    sortOrder: profiles.sortOrder,
  }).from(choreAssignees)
    .innerJoin(profiles, eq(profiles.id, choreAssignees.profileId))
    .where(and(inArray(choreAssignees.choreId, ids), isNull(profiles.archivedAt)))
    .all()
  const assigneesByChore = new Map<string, typeof assigneeRows>()
  for (const row of assigneeRows) {
    const list = assigneesByChore.get(row.choreId) ?? []
    list.push(row)
    assigneesByChore.set(row.choreId, list)
  }

  const completionRows = db.select().from(choreCompletions)
    .where(and(
      inArray(choreCompletions.choreId, ids),
      // rollover needs completion state back to the lookback start
      gte(choreCompletions.dueDate, lookbackStart && lookbackStart < startDate ? lookbackStart : startDate),
      lt(choreCompletions.dueDate, endDate),
    )).all()
  const completionByKey = new Map(
    completionRows.map(c => [`${c.choreId}:${c.profileId}:${c.dueDate}`, c] as const),
  )
  // Latest completion per (chore, assignee) — suppresses non-stacking rollovers.
  const latestCompletion = new Map<string, string>()
  for (const c of completionRows) {
    const key = `${c.choreId}:${c.profileId}`
    const prev = latestCompletion.get(key)
    if (!prev || c.dueDate > prev) latestCompletion.set(key, c.dueDate)
  }

  const out: ChoreInstance[] = []
  for (const chore of candidates) {
    const dates = (chore.rrule
      ? expandDateRule({
          rruleBody: chore.rrule,
          startDate: chore.startDate,
          windowStart: startDate,
          windowEnd: endDate,
        })
      : [chore.startDate].filter(d => d >= startDate && d < endDate)
    ).filter(d => !skipped.has(`${chore.id}:${d}`))

    const assignees = (assigneesByChore.get(chore.id) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder || a.profileName.localeCompare(b.profileName))

    for (const dueDate of dates) {
      for (const a of assignees) {
        const completion = completionByKey.get(`${chore.id}:${a.profileId}:${dueDate}`)
        out.push({
          choreId: chore.id,
          title: chore.title,
          emoji: chore.emoji,
          points: chore.points,
          dueDate,
          dueTime: chore.dueTime,
          profileId: a.profileId,
          profileName: a.profileName,
          profileColor: a.profileColor,
          completed: !!completion,
          completedAt: completion ? completion.completedAt.getTime() : null,
          hasRecurrence: !!chore.rrule,
        })
      }
    }

    if (today) {
      // Occurrences over the lookback, today included so a run scheduled
      // today counts as the "latest" when merging non-stacking misses.
      const occ = (chore.rrule
        ? expandDateRule({
            rruleBody: chore.rrule,
            startDate: chore.startDate,
            windowStart: lookbackStart!,
            windowEnd: addDaysToDateString(today, 1),
          })
        : [chore.startDate].filter(d => d >= lookbackStart! && d <= today)
      ).filter(d => !skipped.has(`${chore.id}:${d}`))

      for (const a of assignees) {
        let rolled: string[]
        if (chore.stacking) {
          // Every missed past day is its own outstanding instance.
          rolled = occ.filter(d =>
            d < today && !completionByKey.has(`${chore.id}:${a.profileId}:${d}`))
        }
        else {
          // At most one: the latest occurrence <= today, unless it IS today
          // (the normal instance covers it) or a completion on/after it
          // already cleared the backlog.
          const latest = occ[occ.length - 1]
          const lastDone = latestCompletion.get(`${chore.id}:${a.profileId}`)
          rolled = latest != null && latest < today && (lastDone == null || lastDone < latest)
            ? [latest]
            : []
        }
        for (const dueDate of rolled) {
          out.push({
            choreId: chore.id,
            title: chore.title,
            emoji: chore.emoji,
            points: chore.points,
            dueDate,
            dueTime: chore.dueTime,
            profileId: a.profileId,
            profileName: a.profileName,
            profileColor: a.profileColor,
            completed: false,
            completedAt: null,
            hasRecurrence: !!chore.rrule,
            overdue: true,
            daysLate: dateStringDiffDays(today, dueDate),
          })
        }
      }
    }
  }

  // Rollovers sort as if due today: after the historical rows, oldest first,
  // ahead of today's scheduled instances.
  const effectiveDate = (i: ChoreInstance) => (i.overdue && today ? today : i.dueDate)
  return out.sort((a, b) =>
    effectiveDate(a).localeCompare(effectiveDate(b))
    || Number(!!b.overdue) - Number(!!a.overdue)
    || (a.overdue ? a.dueDate.localeCompare(b.dueDate) : 0)
    || (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99')
    || a.title.localeCompare(b.title))
}

export interface CompleteChoreArgs {
  choreId: string
  profileId: string
  dueDate: string
  /** Acting profile — authorization (kids only complete their own) lives in the route. */
  completedByProfileId?: string
}

/** Idempotent upsert; pointsAwarded snapshots the chore's CURRENT points. */
export function completeChore(db: Db, args: CompleteChoreArgs) {
  const chore = db.select().from(chores).where(eq(chores.id, args.choreId)).get()
  if (!chore || chore.archivedAt) throw createError({ statusCode: 404, statusMessage: 'Chore not found' })

  return db.insert(choreCompletions).values({
    choreId: args.choreId,
    profileId: args.profileId,
    dueDate: args.dueDate,
    completedAt: new Date(),
    pointsAwarded: chore.points,
  }).onConflictDoUpdate({
    target: [choreCompletions.choreId, choreCompletions.profileId, choreCompletions.dueDate],
    set: { completedAt: new Date(), pointsAwarded: chore.points },
  }).returning().get()
}

/**
 * completeChore plus what the UI needs to celebrate: the points actually
 * banked and the resulting streak for this (chore, profile).
 *
 * A wrapper rather than a change to completeChore's return shape — that
 * function has several existing call sites and specs that assert the raw
 * completion row.
 */
export function completeChoreWithSummary(
  db: Db,
  args: CompleteChoreArgs,
  today: string,
) {
  const completion = completeChore(db, args)
  const streak = getCurrentStreak(db, {
    choreId: args.choreId,
    profileId: args.profileId,
    today,
  })
  return {
    ...completion,
    pointsAwarded: completion.pointsAwarded,
    streak,
  }
}

export function uncompleteChore(db: Db, args: { choreId: string, profileId: string, dueDate: string }) {
  db.delete(choreCompletions).where(and(
    eq(choreCompletions.choreId, args.choreId),
    eq(choreCompletions.profileId, args.profileId),
    eq(choreCompletions.dueDate, args.dueDate),
  )).run()
  return { ok: true }
}
