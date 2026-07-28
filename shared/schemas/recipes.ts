import { z } from 'zod'
import { zHttpUrl } from './common'

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
  /** Shown as the "source" link on the recipe page — see zHttpUrl for why
   *  `z.string().url()` is not enough to put a stored value in an href. */
  sourceUrl: zHttpUrl.max(2000).nullish(),
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
  /**
   * The server fetches this one. Restricting the scheme keeps `file:///etc/…`
   * and `gopher://127.0.0.1:11211/` out of fetch(), and the imported value is
   * also stored as the recipe's sourceUrl and rendered as a link afterwards.
   */
  url: zHttpUrl.max(2000),
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
