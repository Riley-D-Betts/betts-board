import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { createError } from 'h3'
import type { ChoreInstance } from '#shared/schemas/chores'
import type { Db } from '../../db/client'
import { choreAssignees, choreCompletions, choreExceptions, chores, profiles } from '../../db/schema'
import { expandDateRule } from '../calendar/recurrence'

export interface ChoreBoardArgs {
  householdId: string
  startDate: string // inclusive, YYYY-MM-DD
  endDate: string // exclusive, YYYY-MM-DD
}

/** Expand every active chore into per-assignee instances inside [startDate, endDate). */
export function getChoreBoard(db: Db, args: ChoreBoardArgs): ChoreInstance[] {
  const { householdId, startDate, endDate } = args

  const candidates = db.select().from(chores).where(and(
    eq(chores.householdId, householdId),
    isNull(chores.archivedAt),
    lt(chores.startDate, endDate), // series can't occur before it starts
  )).all().filter(c =>
    // recurring: series not over before the window; one-off: startDate in window
    c.rrule ? (c.recurrenceEnd == null || c.recurrenceEnd >= startDate) : c.startDate >= startDate,
  )
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

  const completionByKey = new Map(
    db.select().from(choreCompletions)
      .where(and(
        inArray(choreCompletions.choreId, ids),
        gte(choreCompletions.dueDate, startDate),
        lt(choreCompletions.dueDate, endDate),
      )).all()
      .map(c => [`${c.choreId}:${c.profileId}:${c.dueDate}`, c] as const),
  )

  const out: ChoreInstance[] = []
  for (const chore of candidates) {
    const dates = (chore.rrule
      ? expandDateRule({
          rruleBody: chore.rrule,
          startDate: chore.startDate,
          windowStart: startDate,
          windowEnd: endDate,
        })
      : [chore.startDate]
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
  }

  return out.sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate)
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

export function uncompleteChore(db: Db, args: { choreId: string, profileId: string, dueDate: string }) {
  db.delete(choreCompletions).where(and(
    eq(choreCompletions.choreId, args.choreId),
    eq(choreCompletions.profileId, args.profileId),
    eq(choreCompletions.dueDate, args.dueDate),
  )).run()
  return { ok: true }
}
