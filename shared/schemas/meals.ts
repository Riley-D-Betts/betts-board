import { z } from 'zod'
import { zDateString, zId } from './common'

export const mealSlots = ['breakfast', 'lunch', 'dinner', 'snack'] as const

export const mealEntryCreateSchema = z.object({
  date: zDateString,
  slot: z.enum(mealSlots),
  recipeId: zId.nullish(),
  freeText: z.string().trim().min(1).max(300).nullish(),
  servingsOverride: z.number().positive().max(1000).nullish(),
  cookProfileId: zId.nullish(),
}).refine(e => (e.recipeId == null) !== (e.freeText == null),
  'exactly one of recipeId or freeText is required')

export const mealEntryPatchSchema = z.object({
  date: zDateString.optional(),
  slot: z.enum(mealSlots).optional(),
  recipeId: zId.nullish(),
  freeText: z.string().trim().min(1).max(300).nullish(),
  servingsOverride: z.number().positive().max(1000).nullish(),
  cookProfileId: zId.nullish(),
})

export const DEFAULT_MEAL_TIMES: Record<typeof mealSlots[number], string> = {
  breakfast: '07:30',
  lunch: '12:00',
  dinner: '18:00',
  snack: '15:00',
}

/** Cooking-block padding added to the recipe's total time, minutes. */
export const COOK_PADDING_MINUTES = 15
/** Assumed cook time when a recipe has no time info, minutes. */
export const DEFAULT_COOK_MINUTES = 45

export const mealPlanQuerySchema = z.object({
  start: zDateString,
  end: zDateString, // exclusive
})

export type MealEntryCreate = z.infer<typeof mealEntryCreateSchema>
