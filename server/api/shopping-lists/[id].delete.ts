import { and, eq } from 'drizzle-orm'
import { useDb } from '../../db/client'
import { shoppingLists } from '../../db/schema'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const hh = requireHousehold()

  const deleted = useDb().delete(shoppingLists).where(and(
    eq(shoppingLists.id, id),
    eq(shoppingLists.householdId, hh.id),
  )).returning().get()
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  return { ok: true }
})
