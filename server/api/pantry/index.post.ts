import { pantryItemCreateSchema } from '#shared/schemas/pantry'
import { useDb } from '../../db/client'
import { upsertPantryItem } from '../../services/pantry/items'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const input = await readValidatedBody(event, pantryItemCreateSchema.parse)
  const hh = requireHousehold()

  return upsertPantryItem(useDb(), hh.id, {
    name: input.name,
    quantity: input.quantity ?? null,
    unit: input.unit ?? null,
    category: input.category ?? null,
    barcode: input.barcode ?? null,
  })
})
