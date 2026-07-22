import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import type { ChoreCreate } from '#shared/schemas/chores'
import type { Db } from '../../db/client'
import { choreAssignees, choreExceptions, chores } from '../../db/schema'
import { computeDateRecurrenceEnd } from '../calendar/recurrence'

type ChoreRow = typeof chores.$inferSelect
export type ChoreWithAssignees = ChoreRow & { assigneeProfileIds: string[] }

export function listChores(db: Db, householdId: string): ChoreWithAssignees[] {
  const rows = db.select().from(chores)
    .where(and(eq(chores.householdId, householdId), isNull(chores.archivedAt)))
    .orderBy(asc(chores.createdAt))
    .all()
  if (rows.length === 0) return []
  const assignees = db.select().from(choreAssignees)
    .where(inArray(choreAssignees.choreId, rows.map(r => r.id))).all()
  return rows.map(row => ({
    ...row,
    assigneeProfileIds: assignees.filter(a => a.choreId === row.id).map(a => a.profileId),
  }))
}

export function createChore(db: Db, householdId: string, input: ChoreCreate, createdByProfileId?: string): ChoreWithAssignees {
  const row = db.insert(chores).values({
    householdId,
    title: input.title,
    description: input.description ?? null,
    emoji: input.emoji ?? null,
    points: input.points,
    rrule: input.rrule ?? null,
    startDate: input.startDate,
    dueTime: input.dueTime ?? null,
    stacking: input.stacking,
    recurrenceEnd: input.rrule ? computeDateRecurrenceEnd(input.rrule, input.startDate) : null,
    createdByProfileId: createdByProfileId ?? null,
  }).returning().get()

  db.insert(choreAssignees).values(
    input.assigneeProfileIds.map(profileId => ({ choreId: row.id, profileId })),
  ).run()
  return { ...row, assigneeProfileIds: input.assigneeProfileIds }
}

export type ChorePatch = Partial<ChoreCreate> & { archived?: boolean }

export function updateChore(db: Db, householdId: string, choreId: string, patch: ChorePatch): ChoreWithAssignees {
  const existing = db.select().from(chores)
    .where(and(eq(chores.id, choreId), eq(chores.householdId, householdId))).get()
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Chore not found' })

  const rrule = patch.rrule !== undefined ? (patch.rrule ?? null) : existing.rrule
  const startDate = patch.startDate ?? existing.startDate

  // A schedule change invalidates per-date skips — they key dates that may no longer exist.
  const scheduleChanged
    = (patch.rrule !== undefined && (patch.rrule ?? null) !== existing.rrule)
      || (patch.startDate !== undefined && patch.startDate !== existing.startDate)
  if (scheduleChanged) {
    db.delete(choreExceptions).where(eq(choreExceptions.choreId, choreId)).run()
  }

  const updated = db.update(chores).set({
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.description !== undefined && { description: patch.description ?? null }),
    ...(patch.emoji !== undefined && { emoji: patch.emoji ?? null }),
    ...(patch.points !== undefined && { points: patch.points }),
    ...(patch.dueTime !== undefined && { dueTime: patch.dueTime ?? null }),
    ...(patch.stacking !== undefined && { stacking: patch.stacking }),
    rrule,
    startDate,
    recurrenceEnd: rrule ? computeDateRecurrenceEnd(rrule, startDate) : null,
    ...(patch.archived !== undefined && { archivedAt: patch.archived ? new Date() : null }),
  }).where(eq(chores.id, choreId)).returning().get()

  if (patch.assigneeProfileIds !== undefined) {
    db.delete(choreAssignees).where(eq(choreAssignees.choreId, choreId)).run()
    if (patch.assigneeProfileIds.length) {
      db.insert(choreAssignees).values(
        patch.assigneeProfileIds.map(profileId => ({ choreId, profileId })),
      ).run()
    }
  }

  const assignees = db.select().from(choreAssignees)
    .where(eq(choreAssignees.choreId, choreId)).all()
  return { ...updated, assigneeProfileIds: assignees.map(a => a.profileId) }
}

/** Archive, not hard-delete: completion history keeps its points. */
export function archiveChore(db: Db, householdId: string, choreId: string) {
  const updated = db.update(chores)
    .set({ archivedAt: new Date() })
    .where(and(eq(chores.id, choreId), eq(chores.householdId, householdId)))
    .returning().get()
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Chore not found' })
  return { ok: true }
}
