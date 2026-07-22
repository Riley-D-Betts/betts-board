import { sqliteTable, text, integer, real, index, check } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { id, createdAt } from './_helpers'
import { households } from './household'
import { profiles } from './profiles'
import { recipes } from './recipes'

// No parent "meal_plans" table — a week is just a date-range query.
export const mealPlanEntries = sqliteTable('meal_plan_entries', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  date: text('date').notNull(), // YYYY-MM-DD
  slot: text('slot', { enum: ['breakfast', 'lunch', 'dinner', 'snack'] }).notNull(),
  recipeId: text('recipe_id').references(() => recipes.id, { onDelete: 'cascade' }),
  freeText: text('free_text'), // "Leftovers", "Pizza night out"
  servingsOverride: real('servings_override'),
  // Who's cooking: their calendar shows a block ending at the slot's mealtime,
  // sized by the recipe's total time + 15 min padding.
  cookProfileId: text('cook_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
}, table => [
  index('meal_plan_household_date_idx').on(table.householdId, table.date),
  check('meal_plan_entry_source', sql`(${table.recipeId} IS NULL) != (${table.freeText} IS NULL)`),
])
