import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import type { RedemptionRow, RewardCreate, StarBalance } from '#shared/schemas/rewards'
import type { Db } from '../../db/client'
import { choreCompletions, chores, profiles, rewardRedemptions, rewards } from '../../db/schema'

type RewardRow = typeof rewards.$inferSelect

/** Query-capable db or transaction handle. */
type DbLike = Pick<Db, 'select'>

export function listRewards(db: Db, householdId: string): RewardRow[] {
  return db.select().from(rewards)
    .where(and(eq(rewards.householdId, householdId), isNull(rewards.archivedAt)))
    .orderBy(asc(rewards.sortOrder), asc(rewards.title))
    .all()
}

/** All-time earned (chore completion snapshots) minus spent (redemption snapshots). */
function balanceFor(db: DbLike, profileId: string): number {
  const earned = db.select({ points: choreCompletions.pointsAwarded }).from(choreCompletions)
    .where(eq(choreCompletions.profileId, profileId)).all()
    .reduce((sum, r) => sum + r.points, 0)
  const spent = db.select({ cost: rewardRedemptions.costPoints }).from(rewardRedemptions)
    .where(eq(rewardRedemptions.profileId, profileId)).all()
    .reduce((sum, r) => sum + r.cost, 0)
  return earned - spent
}

export function getBalances(db: Db, householdId: string): StarBalance[] {
  const members = db.select().from(profiles)
    .where(and(eq(profiles.householdId, householdId), isNull(profiles.archivedAt)))
    .orderBy(asc(profiles.sortOrder), asc(profiles.createdAt))
    .all()
  if (members.length === 0) return []

  // Earned: completion snapshots (archived chores' history still counts).
  const earnedRows = db.select({
    profileId: choreCompletions.profileId,
    pointsAwarded: choreCompletions.pointsAwarded,
  }).from(choreCompletions)
    .innerJoin(chores, eq(chores.id, choreCompletions.choreId))
    .where(eq(chores.householdId, householdId))
    .all()

  // Spent: redemption snapshots (archived rewards' history still counts).
  const spentRows = db.select({
    profileId: rewardRedemptions.profileId,
    costPoints: rewardRedemptions.costPoints,
  }).from(rewardRedemptions)
    .innerJoin(rewards, eq(rewards.id, rewardRedemptions.rewardId))
    .where(eq(rewards.householdId, householdId))
    .all()

  const earned = new Map<string, number>()
  for (const r of earnedRows) earned.set(r.profileId, (earned.get(r.profileId) ?? 0) + r.pointsAwarded)
  const spent = new Map<string, number>()
  for (const r of spentRows) spent.set(r.profileId, (spent.get(r.profileId) ?? 0) + r.costPoints)

  return members.map((p) => {
    const e = earned.get(p.id) ?? 0
    const s = spent.get(p.id) ?? 0
    return { profileId: p.id, name: p.name, color: p.color, earned: e, spent: s, balance: e - s }
  })
}

export function redeem(db: Db, args: { rewardId: string, profileId: string }): RedemptionRow {
  return db.transaction((tx) => {
    const reward = tx.select().from(rewards).where(eq(rewards.id, args.rewardId)).get()
    if (!reward || reward.archivedAt) throw createError({ statusCode: 404, statusMessage: 'Reward not found' })

    const profile = tx.select().from(profiles)
      .where(and(
        eq(profiles.id, args.profileId),
        eq(profiles.householdId, reward.householdId),
        isNull(profiles.archivedAt),
      )).get()
    if (!profile) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })

    // Recompute inside the transaction so concurrent redemptions can't overspend.
    if (balanceFor(tx, profile.id) < reward.cost) {
      throw createError({ statusCode: 400, statusMessage: 'Not enough stars' })
    }

    const row = tx.insert(rewardRedemptions).values({
      rewardId: reward.id,
      profileId: profile.id,
      costPoints: reward.cost,
      titleSnapshot: reward.title,
    }).returning().get()

    return {
      id: row.id,
      rewardId: reward.id,
      title: row.titleSnapshot,
      emoji: reward.emoji,
      costPoints: row.costPoints,
      profileId: profile.id,
      profileName: profile.name,
      profileColor: profile.color,
      redeemedAt: row.redeemedAt.getTime(),
    }
  })
}

export function listRedemptions(db: Db, args: { householdId: string, limit?: number }): RedemptionRow[] {
  const rows = db.select({
    id: rewardRedemptions.id,
    rewardId: rewardRedemptions.rewardId,
    title: rewardRedemptions.titleSnapshot,
    emoji: rewards.emoji,
    costPoints: rewardRedemptions.costPoints,
    profileId: rewardRedemptions.profileId,
    profileName: profiles.name,
    profileColor: profiles.color,
    redeemedAt: rewardRedemptions.redeemedAt,
  }).from(rewardRedemptions)
    .innerJoin(rewards, eq(rewards.id, rewardRedemptions.rewardId))
    .innerJoin(profiles, eq(profiles.id, rewardRedemptions.profileId))
    .where(eq(rewards.householdId, args.householdId))
    .orderBy(desc(rewardRedemptions.redeemedAt), desc(rewardRedemptions.id))
    .limit(args.limit ?? 50)
    .all()
  return rows.map(r => ({ ...r, redeemedAt: r.redeemedAt.getTime() }))
}

export function createReward(db: Db, householdId: string, input: RewardCreate): RewardRow {
  return db.insert(rewards).values({
    householdId,
    title: input.title,
    emoji: input.emoji ?? null,
    description: input.description ?? null,
    cost: input.cost,
    sortOrder: input.sortOrder ?? 0,
  }).returning().get()
}

export type RewardPatch = Partial<RewardCreate> & { archived?: boolean }

/** Cost/title edits never touch past redemptions — those carry snapshots. */
export function updateReward(db: Db, householdId: string, rewardId: string, patch: RewardPatch): RewardRow {
  const existing = db.select().from(rewards)
    .where(and(eq(rewards.id, rewardId), eq(rewards.householdId, householdId))).get()
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Reward not found' })

  return db.update(rewards).set({
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.emoji !== undefined && { emoji: patch.emoji ?? null }),
    ...(patch.description !== undefined && { description: patch.description ?? null }),
    ...(patch.cost !== undefined && { cost: patch.cost }),
    ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
    ...(patch.archived !== undefined && { archivedAt: patch.archived ? new Date() : null }),
  }).where(eq(rewards.id, rewardId)).returning().get()
}

/** Archive, not hard-delete: redemption history keeps its snapshots. */
export function archiveReward(db: Db, householdId: string, rewardId: string) {
  const updated = db.update(rewards)
    .set({ archivedAt: new Date() })
    .where(and(eq(rewards.id, rewardId), eq(rewards.householdId, householdId)))
    .returning().get()
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Reward not found' })
  return { ok: true }
}
