import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { id, createdAt } from './_helpers'
import { households } from './household'
import { profiles } from './profiles'

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  profileId: text('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  failCount: integer('fail_count').notNull().default(0), // pruned on 410 Gone or >= 5
  createdAt: createdAt(),
})

// Idempotency ledger: the dispatch task can run every minute safely.
export const notificationLog = sqliteTable('notification_log', {
  id: id(),
  kind: text('kind', { enum: ['event_reminder', 'chore_due', 'test'] }).notNull(),
  refId: text('ref_id').notNull(), // event/chore id
  occurrenceKey: text('occurrence_key').notNull(), // instant ms or dueDate string
  subscriptionId: text('subscription_id').notNull().references(() => pushSubscriptions.id, { onDelete: 'cascade' }),
  sentAt: integer('sent_at', { mode: 'timestamp_ms' }).notNull(),
}, table => [
  uniqueIndex('notification_log_unique').on(table.kind, table.refId, table.occurrenceKey, table.subscriptionId),
])
