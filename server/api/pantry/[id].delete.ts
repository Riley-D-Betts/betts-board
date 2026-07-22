import { and, eq } from 'drizzle-orm'
import { useDb } from '../../db/client'
import { pantryItems } from '../../db/schema'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const hh = requireHousehold()

  const deleted = useDb().delete(pantryItems).where(and(
    eq(pantryItems.id, id),
    eq(pantryItems.householdId, hh.id),
  )).returning().get()
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Pantry item not found' })
  return { ok: true }
})
