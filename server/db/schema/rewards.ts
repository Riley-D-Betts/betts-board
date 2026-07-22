import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { id, createdAt } from './_helpers'
import { households } from './household'
import { profiles } from './profiles'

// The rewards store: chore points ("stars") become spendable. A profile's
// balance is always computed — sum of chore_completions.pointsAwarded minus
// sum of reward_redemptions.costPoints — never stored.
export const rewards = sqliteTable('rewards', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  title: text('title').notNull(),
  emoji: text('emoji'),
  description: text('description'),
  cost: integer('cost').notNull(), // stars
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
})

export const rewardRedemptions = sqliteTable('reward_redemptions', {
  id: id(),
  rewardId: text('reward_id').notNull().references(() => rewards.id),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  // Snapshot: editing a reward's cost later must not rewrite history.
  costPoints: integer('cost_points').notNull(),
  titleSnapshot: text('title_snapshot').notNull(),
  redeemedAt: integer('redeemed_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})
