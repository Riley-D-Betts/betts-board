import { z } from 'zod'

export const recipeIngredientInputSchema = z.object({
  raw: z.string().trim().min(1).max(500),
  // Client may pass pre-parsed fields when editing; otherwise server parses raw.
  quantity: z.number().nullish(),
  unit: z.string().max(30).nullish(),
  name: z.string().max(200).nullish(),
  note: z.string().max(200).nullish(),
})

export const recipeCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullish(),
  sourceUrl: z.string().url().nullish(),
  prepMinutes: z.number().int().min(0).max(10080).nullish(),
  cookMinutes: z.number().int().min(0).max(10080).nullish(),
  totalMinutes: z.number().int().min(0).max(10080).nullish(),
  servings: z.number().positive().max(1000).nullish(),
  steps: z.array(z.string().max(5000)).default([]),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).nullish(),
  ingredients: z.array(recipeIngredientInputSchema).default([]),
})

export const recipePatchSchema = recipeCreateSchema.partial()

export const recipeImportSchema = z.object({
  url: z.string().url().max(2000),
})

export const recipeListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  tag: z.string().max(50).optional(),
  sort: z.enum(['recent', 'rating', 'title']).default('recent'),
})

export const recipeRatingSchema = z.object({
  rating: z.number().int().min(1).max(5),
})

export const recipeNoteCreateSchema = z.object({
  body: z.string().trim().min(1).max(2000),
})

export type RecipeCreate = z.infer<typeof recipeCreateSchema>
export type RecipePatch = z.infer<typeof recipePatchSchema>
