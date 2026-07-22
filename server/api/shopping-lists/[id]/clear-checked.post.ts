import { and, eq } from 'drizzle-orm'
import { clearCheckedSchema } from '#shared/schemas/shopping'
import { useDb } from '../../../db/client'
import { shoppingListItems, shoppingLists } from '../../../db/schema'
import { upsertPantryItem } from '../../../services/pantry/items'
import { requireHousehold, requireProfile } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const listId = getRouterParam(event, 'id')!
  const { toPantry } = await readValidatedBody(event, clearCheckedSchema.parse)
  const hh = requireHousehold()

  const list = useDb().select({ id: shoppingLists.id }).from(shoppingLists).where(and(
    eq(shoppingLists.id, listId),
    eq(shoppingLists.householdId, hh.id),
  )).get()
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const checked = useDb().select().from(shoppingListItems).where(and(
    eq(shoppingListItems.listId, listId),
    eq(shoppingListItems.checked, true),
  )).all()

  if (toPantry) {
    for (const item of checked) {
      upsertPantryItem(useDb(), hh.id, {
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category,
      })
    }
  }

  useDb().delete(shoppingListItems).where(and(
    eq(shoppingListItems.listId, listId),
    eq(shoppingListItems.checked, true),
  )).run()

  return { cleared: checked.length, toPantry: toPantry ? checked.length : 0 }
})
