import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core'
import { id, createdAt, updatedAt } from './_helpers'
import { households } from './household'
import { profiles } from './profiles'

export const recipes = sqliteTable('recipes', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  title: text('title').notNull(),
  description: text('description'),
  sourceUrl: text('source_url'),
  imagePath: text('image_path'),
  prepMinutes: integer('prep_minutes'),
  cookMinutes: integer('cook_minutes'),
  totalMinutes: integer('total_minutes'),
  servings: real('servings'),
  steps: text('steps', { mode: 'json' }).$type<string[]>().notNull(),
  tags: text('tags', { mode: 'json' }).$type<string[]>(),
  createdByProfileId: text('created_by_profile_id').references(() => profiles.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// Structured rows (not JSON): shopping aggregation, search-by-ingredient and
// future pantry checks all need SQL over these.
export const recipeIngredients = sqliteTable('recipe_ingredients', {
  id: id(),
  recipeId: text('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
  raw: text('raw').notNull(), // original line, always preserved and displayed
  // Best-effort parse; all null when the parser couldn't make sense of it.
  quantity: real('quantity'),
  unit: text('unit'),
  name: text('name'),
  note: text('note'), // "(softened)", "divided"
})

export const recipeRatings = sqliteTable('recipe_ratings', {
  recipeId: text('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(), // 1-5
  updatedAt: updatedAt(),
}, table => [primaryKey({ columns: [table.recipeId, table.profileId] })])

// Comment-style thread: "double the sauce next time — Mom"
export const recipeNotes = sqliteTable('recipe_notes', {
  id: id(),
  recipeId: text('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  profileId: text('profile_id').references(() => profiles.id),
  body: text('body').notNull(),
  createdAt: createdAt(),
})
