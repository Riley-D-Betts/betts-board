import { and, eq } from 'drizzle-orm'
import { mealEntryPatchSchema } from '#shared/schemas/meals'
import { useDb } from '../../../db/client'
import { mealPlanEntries, profiles, recipes } from '../../../db/schema'
import { requireHousehold, requireProfile } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const patch = await readValidatedBody(event, mealEntryPatchSchema.parse)
  const hh = requireHousehold()

  const existing = useDb().select().from(mealPlanEntries).where(and(
    eq(mealPlanEntries.id, id),
    eq(mealPlanEntries.householdId, hh.id),
  )).get()
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Meal entry not found' })

  const next = {
    date: patch.date ?? existing.date,
    slot: patch.slot ?? existing.slot,
    recipeId: patch.recipeId !== undefined ? patch.recipeId ?? null : existing.recipeId,
    freeText: patch.freeText !== undefined ? patch.freeText ?? null : existing.freeText,
    servingsOverride: patch.servingsOverride !== undefined
      ? patch.servingsOverride ?? null
      : existing.servingsOverride,
    cookProfileId: patch.cookProfileId !== undefined
      ? patch.cookProfileId ?? null
      : existing.cookProfileId,
  }
  // Switching source clears the other side automatically.
  if (patch.recipeId != null && patch.freeText === undefined) next.freeText = null
  if (patch.freeText != null && patch.recipeId === undefined) next.recipeId = null
  if ((next.recipeId == null) === (next.freeText == null)) {
    throw createError({ statusCode: 400, statusMessage: 'Exactly one of recipeId or freeText is required' })
  }

  if (next.recipeId && next.recipeId !== existing.recipeId) {
    const recipe = useDb().select({ id: recipes.id }).from(recipes).where(and(
      eq(recipes.id, next.recipeId),
      eq(recipes.householdId, hh.id),
    )).get()
    if (!recipe) throw createError({ statusCode: 404, statusMessage: 'Recipe not found' })
  }

  if (next.cookProfileId && next.cookProfileId !== existing.cookProfileId) {
    const cook = useDb().select({ id: profiles.id }).from(profiles).where(and(
      eq(profiles.id, next.cookProfileId),
      eq(profiles.householdId, hh.id),
    )).get()
    if (!cook) throw createError({ statusCode: 404, statusMessage: 'Cook profile not found' })
  }

  return useDb().update(mealPlanEntries).set(next)
    .where(eq(mealPlanEntries.id, id)).returning().get()
})
