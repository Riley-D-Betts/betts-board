import { and, asc, eq } from 'drizzle-orm'
import { useDb } from '../../../../db/client'
import { mealPlanEntries, recipeIngredients, recipes } from '../../../../db/schema'
import { formatCount } from '../../../../services/shopping/units'
import { requireHousehold, requireUnlocked } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const id = getRouterParam(event, 'id')!
  const hh = requireHousehold()

  const entry = useDb().select().from(mealPlanEntries).where(and(
    eq(mealPlanEntries.id, id),
    eq(mealPlanEntries.householdId, hh.id),
  )).get()
  if (!entry || entry.recipeId == null) {
    throw createError({ statusCode: 404, statusMessage: 'Meal entry not found' })
  }

  const recipe = useDb().select().from(recipes).where(
    eq(recipes.id, entry.recipeId),
  ).get()
  if (!recipe) throw createError({ statusCode: 404, statusMessage: 'Recipe not found' })

  const scale = entry.servingsOverride && recipe.servings
    ? entry.servingsOverride / recipe.servings
    : 1

  const ingredients = useDb().select().from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipe.id))
    .orderBy(asc(recipeIngredients.sortOrder)).all()
    .map((ing) => {
      const scaledQuantity = ing.quantity != null ? ing.quantity * scale : null
      const display = scaledQuantity != null && ing.name
        ? [formatCount(scaledQuantity), ing.unit, ing.name].filter(Boolean).join(' ')
        : ing.raw
      return {
        id: ing.id,
        raw: ing.raw,
        quantity: ing.quantity,
        unit: ing.unit,
        name: ing.name,
        scaledQuantity,
        /** Scaled human-readable line ("3 cups flour"); raw when unparsed. */
        display,
      }
    })

  return {
    entryId: entry.id,
    recipeId: recipe.id,
    title: recipe.title,
    servings: recipe.servings,
    servingsOverride: entry.servingsOverride,
    scale,
    ingredients,
  }
})
