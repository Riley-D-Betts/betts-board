import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { id, createdAt } from './_helpers'
import { households } from './household'
import { profiles } from './profiles'

export const shoppingLists = sqliteTable('shopping_lists', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  name: text('name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
})

export const shoppingListItems = sqliteTable('shopping_list_items', {
  id: id(),
  listId: text('list_id').notNull().references(() => shoppingLists.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // What the user sees: "1½ cups + 2 tbsp". Canonical quantity/unit are for merging.
  displayQuantity: text('display_quantity'),
  quantity: real('quantity'),
  unit: text('unit'),
  category: text('category'), // aisle: Produce/Dairy/Meat/Pantry/Frozen/…
  checked: integer('checked', { mode: 'boolean' }).notNull().default(false),
  checkedAt: integer('checked_at', { mode: 'timestamp_ms' }),
  sortOrder: integer('sort_order').notNull().default(0),
  sourceRecipeIds: text('source_recipe_ids', { mode: 'json' }).$type<string[]>(),
  createdByProfileId: text('created_by_profile_id').references(() => profiles.id),
  createdAt: createdAt(),
})
