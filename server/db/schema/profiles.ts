import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { id, createdAt } from './_helpers'
import { households } from './household'

export const profiles = sqliteTable('profiles', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  name: text('name').notNull(),
  color: text('color').notNull(), // hex, used for event chips / avatars
  avatarPath: text('avatar_path'),
  role: text('role', { enum: ['admin', 'adult', 'kid'] }).notNull().default('adult'),
  pinHash: text('pin_hash'), // null in v1; future per-profile PINs
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
})
