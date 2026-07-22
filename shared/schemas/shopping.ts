import { z } from 'zod'
import { zDateString, zId } from './common'

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

export const clearCheckedSchema = z.object({
  /** Move checked items into the pantry before clearing ("put away groceries"). */
  toPantry: z.boolean().default(false),
})

export type GenerateFromMealPlan = z.infer<typeof generateFromMealPlanSchema>

/** Response of the generate endpoint — feeds the confirmation toast/dialog. */
export interface GenerateResult {
  created: number
  merged: number
  inPantry: { name: string, itemId: string }[] // added but flagged; user can remove
  skippedFreeText: string[] // free-text meals we couldn't shop for
}
