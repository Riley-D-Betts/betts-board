import { and, eq, isNull, sql } from 'drizzle-orm'
import { dateStringDiffDays, todayString } from '#shared/utils/dates'
import type { Db } from '../../db/client'
import { financeGoalContributions, financeGoals } from '../../db/schema'
import { listAccounts } from './accounts'

export interface GoalDto {
  id: string
  name: string
  targetMinor: number
  currency: string
  targetDate: string | null
  accountId: string | null
  accountName: string | null
  icon: string | null
  color: string | null
  savedMinor: number
  remainingMinor: number
  progress: number
  /** Null when there's no deadline, or when the goal is already met. */
  perMonthNeededMinor: number | null
  daysRemaining: number | null
  onTrack: boolean | null
  archivedAt: number | null
}

/**
 * Progress comes from one of two places and never both: a linked savings
 * account's balance, or the manual contribution ledger. Mixing them would
 * double-count the moment somebody records a transfer they also see on the
 * account.
 */
export function listGoals(db: Db, householdId: string, includeArchived = false): GoalDto[] {
  const rows = db.select().from(financeGoals)
    .where(includeArchived
      ? eq(financeGoals.householdId, householdId)
      : and(eq(financeGoals.householdId, householdId), isNull(financeGoals.archivedAt)))
    .all()

  const accounts = new Map(listAccounts(db, householdId, true).map(a => [a.id, a]))
  const today = todayString()

  return rows.map((goal) => {
    const account = goal.accountId ? accounts.get(goal.accountId) : undefined
    const savedMinor = account
      ? Math.max(0, account.balanceMinor)
      : db.select({ total: sql<number>`coalesce(sum(${financeGoalContributions.amountMinor}), 0)` })
          .from(financeGoalContributions)
          .where(eq(financeGoalContributions.goalId, goal.id))
          .get()?.total ?? 0

    const remainingMinor = Math.max(0, goal.targetMinor - savedMinor)
    const daysRemaining = goal.targetDate ? dateStringDiffDays(goal.targetDate, today) : null

    let perMonthNeededMinor: number | null = null
    let onTrack: boolean | null = null
    if (goal.targetDate && remainingMinor > 0) {
      // Round up: telling someone £312/month when £312.50 is needed is the
      // kind of small lie that makes them miss the date.
      const months = Math.max(1, Math.ceil((daysRemaining ?? 0) / 30))
      perMonthNeededMinor = daysRemaining !== null && daysRemaining < 0
        ? remainingMinor
        : Math.ceil(remainingMinor / months)
      onTrack = (daysRemaining ?? 0) >= 0
    }
    else if (goal.targetDate) {
      onTrack = true
    }

    return {
      id: goal.id,
      name: goal.name,
      targetMinor: goal.targetMinor,
      currency: goal.currency,
      targetDate: goal.targetDate,
      accountId: goal.accountId,
      accountName: account?.name ?? null,
      icon: goal.icon,
      color: goal.color,
      savedMinor,
      remainingMinor,
      progress: goal.targetMinor > 0 ? Math.min(1, savedMinor / goal.targetMinor) : 0,
      perMonthNeededMinor,
      daysRemaining,
      onTrack,
      archivedAt: goal.archivedAt?.getTime() ?? null,
    }
  })
}

export function createGoal(db: Db, householdId: string, input: Record<string, unknown>) {
  return db.insert(financeGoals).values({ householdId, ...input } as never).returning().get()
}

export function patchGoal(db: Db, householdId: string, id: string, patch: Record<string, unknown>) {
  const row = db.select().from(financeGoals)
    .where(and(eq(financeGoals.id, id), eq(financeGoals.householdId, householdId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Goal not found' })

  const { archived, ...rest } = patch as { archived?: boolean }
  const values: Record<string, unknown> = { ...rest }
  if (archived !== undefined) values.archivedAt = archived ? new Date() : null
  return db.update(financeGoals).set(values).where(eq(financeGoals.id, id)).returning().get()
}

export function deleteGoal(db: Db, householdId: string, id: string): void {
  const row = db.select().from(financeGoals)
    .where(and(eq(financeGoals.id, id), eq(financeGoals.householdId, householdId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Goal not found' })
  db.delete(financeGoals).where(eq(financeGoals.id, id)).run()
}

export function contributeToGoal(db: Db, householdId: string, goalId: string, args: {
  profileId: string
  amountMinor: number
  contributedOn: string
  note?: string | null
}) {
  const goal = db.select().from(financeGoals)
    .where(and(eq(financeGoals.id, goalId), eq(financeGoals.householdId, householdId))).get()
  if (!goal) throw createError({ statusCode: 404, statusMessage: 'Goal not found' })
  if (goal.accountId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This goal tracks an account balance — move money into the account instead',
    })
  }

  return db.insert(financeGoalContributions).values({
    goalId,
    amountMinor: args.amountMinor,
    contributedOn: args.contributedOn,
    note: args.note ?? null,
    createdByProfileId: args.profileId,
  }).returning().get()
}

export function listContributions(db: Db, goalId: string) {
  return db.select().from(financeGoalContributions)
    .where(eq(financeGoalContributions.goalId, goalId))
    .all()
    .map(c => ({ ...c, createdAt: c.createdAt.getTime() }))
}

export function deleteContribution(db: Db, goalId: string, id: string): void {
  const row = db.select().from(financeGoalContributions)
    .where(and(eq(financeGoalContributions.id, id), eq(financeGoalContributions.goalId, goalId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Contribution not found' })
  db.delete(financeGoalContributions).where(eq(financeGoalContributions.id, id)).run()
}
