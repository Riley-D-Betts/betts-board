import { sqliteTable, text, real, integer, index } from 'drizzle-orm/sqlite-core'
import { id, createdAt, updatedAt } from './_helpers'
import { households } from './household'

export const pantryItems = sqliteTable('pantry_items', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  name: text('name').notNull(),
  // Normalized (lowercased, de-noted) key — what shopping generation matches on.
  nameKey: text('name_key').notNull(),
  quantity: real('quantity'), // loose/optional: "2" bags, or null = "have some"
  unit: text('unit'),
  category: text('category'),
  barcode: text('barcode'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [index('pantry_household_key_idx').on(table.householdId, table.nameKey)])

// Open Food Facts lookups + manual corrections, cached so re-scanning the
// same jar resolves instantly and offline.
export const barcodeCache = sqliteTable('barcode_cache', {
  barcode: text('barcode').primaryKey(),
  productName: text('product_name').notNull(),
  brand: text('brand'),
  imageUrl: text('image_url'),
  source: text('source', { enum: ['off', 'manual'] }).notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
})
