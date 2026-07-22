import { and, asc, eq } from 'drizzle-orm'
import { useDb } from '../../db/client'
import { shoppingListItems, shoppingLists } from '../../db/schema'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const id = getRouterParam(event, 'id')!
  const hh = requireHousehold()

  const list = useDb().select().from(shoppingLists).where(and(
    eq(shoppingLists.id, id),
    eq(shoppingLists.householdId, hh.id),
  )).get()
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const items = useDb().select().from(shoppingListItems)
    .where(eq(shoppingListItems.listId, id))
    .orderBy(asc(shoppingListItems.sortOrder), asc(shoppingListItems.createdAt))
    .all()

  return { ...list, items }
})
