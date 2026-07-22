import { and, eq } from 'drizzle-orm'
import { shoppingListPatchSchema } from '#shared/schemas/shopping'
import { useDb } from '../../db/client'
import { shoppingLists } from '../../db/schema'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const patch = await readValidatedBody(event, shoppingListPatchSchema.parse)
  const hh = requireHousehold()

  const existing = useDb().select().from(shoppingLists).where(and(
    eq(shoppingLists.id, id),
    eq(shoppingLists.householdId, hh.id),
  )).get()
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  if (patch.isDefault) {
    useDb().update(shoppingLists).set({ isDefault: false })
      .where(eq(shoppingLists.householdId, hh.id)).run()
  }

  return useDb().update(shoppingLists).set({
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.isDefault !== undefined && { isDefault: patch.isDefault }),
  }).where(eq(shoppingLists.id, id)).returning().get()
})
