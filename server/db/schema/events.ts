import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core'
import { id, createdAt, updatedAt } from './_helpers'
import { households } from './household'
import { profiles } from './profiles'

export const calendarFeeds = sqliteTable('calendar_feeds', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  name: text('name').notNull(),
  url: text('url').notNull(),
  color: text('color').notNull().default('#64748b'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  fetchIntervalMinutes: integer('fetch_interval_minutes').notNull().default(60),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp_ms' }),
  lastStatus: text('last_status', { enum: ['ok', 'error'] }),
  lastError: text('last_error'),
  createdAt: createdAt(),
})

export const events = sqliteTable('events', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  title: text('title').notNull(),
  description: text('description'),
  location: text('location'),
  isAllDay: integer('is_all_day', { mode: 'boolean' }).notNull().default(false),
  // Timed events: UTC instants + the IANA zone they were authored in.
  startAt: integer('start_at', { mode: 'timestamp_ms' }),
  endAt: integer('end_at', { mode: 'timestamp_ms' }),
  // All-day events: local date strings, never timezone-converted. endDate exclusive.
  startDate: text('start_date'),
  endDate: text('end_date'),
  timezone: text('timezone').notNull(),
  // Bare RRULE body ("FREQ=WEEKLY;BYDAY=MO") — DTSTART is derived from
  // startAt/startDate at expansion time so the two can never disagree.
  rrule: text('rrule'),
  // Denormalized last-occurrence instant (from UNTIL/COUNT at write time).
  // Null = repeats forever. Makes the window query index-friendly.
  recurrenceEnd: integer('recurrence_end', { mode: 'timestamp_ms' }),
  reminderMinutes: text('reminder_minutes', { mode: 'json' }).$type<number[]>(),
  color: text('color'),
  // Non-null feedId ⇒ imported from an ICS subscription (read-only in the UI).
  feedId: text('feed_id').references(() => calendarFeeds.id, { onDelete: 'cascade' }),
  externalUid: text('external_uid'),
  createdByProfileId: text('created_by_profile_id').references(() => profiles.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [
  uniqueIndex('events_feed_uid_unique').on(table.feedId, table.externalUid),
  index('events_household_start_idx').on(table.householdId, table.startAt),
  index('events_household_rrule_idx').on(table.householdId, table.rrule),
])

export const eventAttendees = sqliteTable('event_attendees', {
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
}, table => [primaryKey({ columns: [table.eventId, table.profileId] })])

// One row per touched occurrence, keyed by the occurrence's ORIGINAL instant.
// Imported EXDATEs become 'skipped' rows and RECURRENCE-ID overrides become
// 'modified' rows, so local and feed events share one expansion pipeline.
export const eventExceptions = sqliteTable('event_exceptions', {
  id: id(),
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  occurrenceStart: integer('occurrence_start', { mode: 'timestamp_ms' }).notNull(),
  kind: text('kind', { enum: ['skipped', 'modified'] }).notNull(),
  // Sparse overrides — only non-null fields replace the master's values.
  newStartAt: integer('new_start_at', { mode: 'timestamp_ms' }),
  newEndAt: integer('new_end_at', { mode: 'timestamp_ms' }),
  newTitle: text('new_title'),
  newLocation: text('new_location'),
  newDescription: text('new_description'),
}, table => [uniqueIndex('event_exceptions_unique').on(table.eventId, table.occurrenceStart)])
