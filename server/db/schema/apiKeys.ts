import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { id, createdAt } from './_helpers'
import { households } from './household'
import { profiles } from './profiles'

// Public-API access tokens ("Authorization: Bearer bb_…"). The token itself
// is shown once at creation; only its SHA-256 hex digest is stored.
export const apiKeys = sqliteTable('api_keys', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  name: text('name').notNull(), // "Home Assistant", "Grocy sync", …
  tokenHash: text('token_hash').notNull().unique(),
  // Optional acting profile: requests act as this member (needed for routes
  // that attribute actions — completing chores, adding notes). Null = the
  // key can only use routes that don't need an acting profile.
  profileId: text('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
})
