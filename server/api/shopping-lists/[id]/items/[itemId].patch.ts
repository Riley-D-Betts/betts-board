import { and, eq } from 'drizzle-orm'
import { shoppingItemPatchSchema } from '#shared/schemas/shopping'
import { useDb } from '../../../../db/client'
import { shoppingListItems, shoppingLists } from '../../../../db/schema'
import { categorize } from '../../../../services/shopping/aisles'
import { normalizeNameKey } from '../../../../services/shopping/units'
import { requireHousehold, requireProfile } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const listId = getRouterParam(event, 'id')!
  const itemId = getRouterParam(event, 'itemId')!
  const patch = await readValidatedBody(event, shoppingItemPatchSchema.parse)
  const hh = requireHousehold()

  const list = useDb().select({ id: shoppingLists.id }).from(shoppingLists).where(and(
    eq(shoppingLists.id, listId),
    eq(shoppingLists.householdId, hh.id),
  )).get()
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const existing = useDb().select().from(shoppingListItems).where(and(
    eq(shoppingListItems.id, itemId),
    eq(shoppingListItems.listId, listId),
  )).get()
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Item not found' })

  return useDb().update(shoppingListItems).set({
    ...(patch.name !== undefined && {
      name: patch.name,
      // Renaming re-aisles the item unless the caller pins a category.
      ...(patch.category === undefined && { category: categorize(normalizeNameKey(patch.name)) }),
    }),
    ...(patch.displayQuantity !== undefined && { displayQuantity: patch.displayQuantity }),
    ...(patch.quantity !== undefined && { quantity: patch.quantity }),
    ...(patch.unit !== undefined && { unit: patch.unit }),
    ...(patch.category !== undefined && { category: patch.category }),
    ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
    ...(patch.checked !== undefined && {
      checked: patch.checked,
      checkedAt: patch.checked ? new Date() : null,
    }),
  }).where(eq(shoppingListItems.id, itemId)).returning().get()
})
