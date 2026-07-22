import { z } from 'zod'
import { zDateString, zId } from './common'

export const mealSlots = ['breakfast', 'lunch', 'dinner', 'snack'] as const

export const mealEntryCreateSchema = z.object({
  date: zDateString,
  slot: z.enum(mealSlots),
  recipeId: zId.nullish(),
  freeText: z.string().trim().min(1).max(300).nullish(),
  servingsOverride: z.number().positive().max(1000).nullish(),
}).refine(e => (e.recipeId == null) !== (e.freeText == null),
  'exactly one of recipeId or freeText is required')

export const mealEntryPatchSchema = z.object({
  date: zDateString.optional(),
  slot: z.enum(mealSlots).optional(),
  recipeId: zId.nullish(),
  freeText: z.string().trim().min(1).max(300).nullish(),
  servingsOverride: z.number().positive().max(1000).nullish(),
})

export const mealPlanQuerySchema = z.object({
  start: zDateString,
  end: zDateString, // exclusive
})

export type MealEntryCreate = z.infer<typeof mealEntryCreateSchema>
