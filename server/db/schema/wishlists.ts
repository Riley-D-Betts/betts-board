import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { id, createdAt } from './_helpers'
import { households } from './household'
import { profiles } from './profiles'

// Birthday/holiday wish lists. Shared by design: everyone in the household
// sees every list. There is deliberately no "claimed"/"purchased" column —
// gift-hiding is a separate feature with its own visibility rules, and a
// half-wired column would be worse than none.
export const wishlists = sqliteTable('wishlists', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  // Every list belongs to the person who wants the things on it.
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  // Free text ("Christmas 2026", "Emma's 8th") — families invent occasions,
  // so an enum would be wrong within a month.
  occasion: text('occasion'),
  // YYYY-MM-DD calendar date, never timezone-converted. Drives the countdown.
  eventDate: text('event_date'),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
})

export const wishlistItems = sqliteTable('wishlist_items', {
  id: id(),
  wishlistId: text('wishlist_id').notNull().references(() => wishlists.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url'),
  notes: text('notes'),
  // Free text ("about $30", "£15-20"). A numeric price would force a currency
  // choice and locale-aware currency formatting for no real gain here.
  price: text('price'),
  // 0 = nice to have, 1 = would love, 2 = really wants
  priority: integer('priority').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  createdByProfileId: text('created_by_profile_id').references(() => profiles.id),
  createdAt: createdAt(),
})
