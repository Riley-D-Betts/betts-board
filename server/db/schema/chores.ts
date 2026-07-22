import { sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { id, createdAt } from './_helpers'
import { households } from './household'
import { profiles } from './profiles'

// Chores are date-based (no timezones anywhere): recurrence expands over
// local date strings. dueTime is display/notification sugar only.
export const chores = sqliteTable('chores', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  title: text('title').notNull(),
  description: text('description'),
  emoji: text('emoji'),
  points: integer('points').notNull().default(1),
  rrule: text('rrule'), // null = one-off on startDate
  startDate: text('start_date').notNull(), // YYYY-MM-DD
  dueTime: text('due_time'), // "17:00", optional
  // Missed occurrences roll to today. Stacking on: each missed day piles up
  // (laundry). Off: missed days merge into a single outstanding instance
  // (mow the lawn — you don't mow twice).
  stacking: integer('stacking', { mode: 'boolean' }).notNull().default(false),
  recurrenceEnd: text('recurrence_end'), // YYYY-MM-DD, null = forever
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdByProfileId: text('created_by_profile_id').references(() => profiles.id),
  createdAt: createdAt(),
})

export const choreAssignees = sqliteTable('chore_assignees', {
  choreId: text('chore_id').notNull().references(() => chores.id, { onDelete: 'cascade' }),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
}, table => [primaryKey({ columns: [table.choreId, table.profileId] })])

export const choreCompletions = sqliteTable('chore_completions', {
  id: id(),
  choreId: text('chore_id').notNull().references(() => chores.id, { onDelete: 'cascade' }),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  dueDate: text('due_date').notNull(), // occurrence key, YYYY-MM-DD
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }).notNull(),
  // Snapshot: editing a chore's points later must not rewrite history.
  pointsAwarded: integer('points_awarded').notNull(),
}, table => [uniqueIndex('chore_completions_unique').on(table.choreId, table.profileId, table.dueDate)])

// "Skip this Saturday" — hides one occurrence date for everyone.
export const choreExceptions = sqliteTable('chore_exceptions', {
  choreId: text('chore_id').notNull().references(() => chores.id, { onDelete: 'cascade' }),
  dueDate: text('due_date').notNull(),
}, table => [primaryKey({ columns: [table.choreId, table.dueDate] })])
