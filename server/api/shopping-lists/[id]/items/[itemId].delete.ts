import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../db/client'
import { shoppingListItems, shoppingLists } from '../../../../db/schema'
import { requireHousehold, requireProfile } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const listId = getRouterParam(event, 'id')!
  const itemId = getRouterParam(event, 'itemId')!
  const hh = requireHousehold()

  const list = useDb().select({ id: shoppingLists.id }).from(shoppingLists).where(and(
    eq(shoppingLists.id, listId),
    eq(shoppingLists.householdId, hh.id),
  )).get()
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const deleted = useDb().delete(shoppingListItems).where(and(
    eq(shoppingListItems.id, itemId),
    eq(shoppingListItems.listId, listId),
  )).returning().get()
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Item not found' })
  return { ok: true }
})
