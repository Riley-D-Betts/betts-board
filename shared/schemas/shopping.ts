import { z } from 'zod'
import { zDateString, zId } from './common'

/**
 * Store aisles, in walk-the-store order — the shopping list and the pantry
 * share one vocabulary (the pantry service categorises through the same
 * matcher), so both screens read this list.
 *
 * These strings are VALUES, not labels: `server/services/shopping/aisles.ts`
 * assigns them from a deliberately English-only keyword map and they are what
 * lands in the `category` column. Never translate them in place — translate
 * the label via `aisleLabelKey()` and leave the stored value alone.
 */
export const AISLES = [
  'Produce',
  'Bakery',
  'Meat & Seafood',
  'Dairy',
  'Frozen',
  'Pantry',
  'Beverages',
  'Household',
  'Other',
] as const

export type Aisle = (typeof AISLES)[number]

const AISLE_KEYS: Record<Aisle, string> = {
  'Produce': 'produce',
  'Bakery': 'bakery',
  'Meat & Seafood': 'meatSeafood',
  'Dairy': 'dairy',
  'Frozen': 'frozen',
  'Pantry': 'pantry',
  'Beverages': 'beverages',
  'Household': 'household',
  'Other': 'other',
}

/**
 * i18n key for a stored aisle value, or null when nothing matches — items can
 * carry a custom aisle somebody typed, and that has no translation to look up.
 */
export function aisleLabelKey(value: string): string | null {
  const key = AISLE_KEYS[value as Aisle]
  return key ? `shopping.aisles.${key}` : null
}

export const shoppingListCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  isDefault: z.boolean().default(false),
})

export const shoppingListPatchSchema = shoppingListCreateSchema.partial()

export const shoppingItemCreateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  displayQuantity: z.string().max(100).nullish(),
  quantity: z.number().nullish(),
  unit: z.string().max(30).nullish(),
  category: z.string().max(50).nullish(),
})

export const shoppingItemPatchSchema = shoppingItemCreateSchema.partial().extend({
  checked: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export const generateFromMealPlanSchema = z.object({
  start: zDateString,
  end: zDateString, // exclusive
  listId: zId.optional(), // default list when omitted
  /** Include ingredients even when the pantry already has them. */
  ignorePantry: z.boolean().default(false),
})

export const addFromRecipeSchema = z.object({
  recipeId: zId,
  ingredientIds: z.array(zId).min(1),
  /** Multiply parsed quantities (servingsOverride / recipe servings). */
  scale: z.number().positive().max(1000).default(1),
})

export const clearCheckedSchema = z.object({
  /** Move checked items into the pantry before clearing ("put away groceries"). */
  toPantry: z.boolean().default(false),
})

export type GenerateFromMealPlan = z.infer<typeof generateFromMealPlanSchema>
export type AddFromRecipe = z.infer<typeof addFromRecipeSchema>

/** Response of the from-recipe endpoint — feeds the confirmation toast. */
export interface AddRecipeItemsResult {
  created: number
  merged: number
  listId: string
}

/** Response of the generate endpoint — feeds the confirmation toast/dialog. */
export interface GenerateResult {
  created: number
  merged: number
  inPantry: { name: string, itemId: string }[] // added but flagged; user can remove
  skippedFreeText: string[] // free-text meals we couldn't shop for
}
