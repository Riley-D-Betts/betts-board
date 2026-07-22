import { and, eq } from 'drizzle-orm'
import { pantryItemPatchSchema } from '#shared/schemas/pantry'
import { useDb } from '../../db/client'
import { pantryItems } from '../../db/schema'
import { normalizeNameKey } from '../../services/shopping/units'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const patch = await readValidatedBody(event, pantryItemPatchSchema.parse)
  const hh = requireHousehold()

  const existing = useDb().select().from(pantryItems).where(and(
    eq(pantryItems.id, id),
    eq(pantryItems.householdId, hh.id),
  )).get()
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Pantry item not found' })

  return useDb().update(pantryItems).set({
    ...(patch.name !== undefined && {
      name: patch.name,
      nameKey: normalizeNameKey(patch.name), // keep the merge key in sync
    }),
    ...(patch.quantity !== undefined && { quantity: patch.quantity }),
    ...(patch.unit !== undefined && { unit: patch.unit }),
    ...(patch.category !== undefined && { category: patch.category }),
    ...(patch.barcode !== undefined && { barcode: patch.barcode }),
  }).where(eq(pantryItems.id, id)).returning().get()
})
