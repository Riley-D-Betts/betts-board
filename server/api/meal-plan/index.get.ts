import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { mealPlanQuerySchema } from '#shared/schemas/meals'
import { useDb } from '../../db/client'
import { mealPlanEntries, recipeRatings, recipes } from '../../db/schema'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const { start, end } = await getValidatedQuery(event, mealPlanQuerySchema.parse)
  const hh = requireHousehold()

  const entries = useDb().select().from(mealPlanEntries).where(and(
    eq(mealPlanEntries.householdId, hh.id),
    gte(mealPlanEntries.date, start),
    lt(mealPlanEntries.date, end),
  )).orderBy(asc(mealPlanEntries.date), asc(mealPlanEntries.sortOrder)).all()

  const recipeIds = [...new Set(entries.map(e => e.recipeId).filter((id): id is string => id != null))]
  const recipeById = new Map(
    recipeIds.length
      ? useDb().select({
          id: recipes.id,
          title: recipes.title,
          imagePath: recipes.imagePath,
          servings: recipes.servings,
          avgRating: sql<number | null>`(
            select avg(${recipeRatings.rating}) from ${recipeRatings}
            where ${recipeRatings.recipeId} = ${recipes.id}
          )`,
        }).from(recipes).where(inArray(recipes.id, recipeIds)).all().map(r => [r.id, r] as const)
      : [],
  )

  return entries.map(e => ({
    ...e,
    recipe: e.recipeId ? recipeById.get(e.recipeId) ?? null : null,
  }))
})
