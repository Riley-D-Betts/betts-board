import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../db/client'
import { shoppingListItems, shoppingLists } from '../../../db/schema'
import { requireProfile } from '../../../utils/session'

// Empties the list entirely (checked and unchecked). The list itself stays.
export default defineEventHandler(async (event) => {
  const { session } = await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb()

  const list = db.select().from(shoppingLists).where(and(
    eq(shoppingLists.id, id),
    eq(shoppingLists.householdId, session.householdId),
  )).get()
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const result = db.delete(shoppingListItems).where(eq(shoppingListItems.listId, id)).run()
  return { ok: true, removed: result.changes }
})
