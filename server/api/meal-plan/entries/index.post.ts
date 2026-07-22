import { and, eq } from 'drizzle-orm'
import { mealEntryCreateSchema } from '#shared/schemas/meals'
import { useDb } from '../../../db/client'
import { mealPlanEntries, profiles, recipes } from '../../../db/schema'
import { requireHousehold, requireProfile } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const input = await readValidatedBody(event, mealEntryCreateSchema.parse)
  const hh = requireHousehold()

  if (input.recipeId) {
    const recipe = useDb().select({ id: recipes.id }).from(recipes).where(and(
      eq(recipes.id, input.recipeId),
      eq(recipes.householdId, hh.id),
    )).get()
    if (!recipe) throw createError({ statusCode: 404, statusMessage: 'Recipe not found' })
  }

  if (input.cookProfileId) {
    const cook = useDb().select({ id: profiles.id }).from(profiles).where(and(
      eq(profiles.id, input.cookProfileId),
      eq(profiles.householdId, hh.id),
    )).get()
    if (!cook) throw createError({ statusCode: 404, statusMessage: 'Cook profile not found' })
  }

  return useDb().insert(mealPlanEntries).values({
    householdId: hh.id,
    date: input.date,
    slot: input.slot,
    recipeId: input.recipeId ?? null,
    freeText: input.freeText ?? null,
    servingsOverride: input.servingsOverride ?? null,
    cookProfileId: input.cookProfileId ?? null,
  }).returning().get()
})
