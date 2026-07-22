import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../db/client'
import { mealPlanEntries } from '../../../db/schema'
import { requireHousehold, requireProfile } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const hh = requireHousehold()

  const deleted = useDb().delete(mealPlanEntries).where(and(
    eq(mealPlanEntries.id, id),
    eq(mealPlanEntries.householdId, hh.id),
  )).returning().get()
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Meal entry not found' })
  return { ok: true }
})
