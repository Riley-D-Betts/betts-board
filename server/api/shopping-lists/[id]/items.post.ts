import { and, eq } from 'drizzle-orm'
import { shoppingItemCreateSchema } from '#shared/schemas/shopping'
import { useDb } from '../../../db/client'
import { shoppingListItems, shoppingLists } from '../../../db/schema'
import { categorize } from '../../../services/shopping/aisles'
import { formatCount, formatQuantity, normalizeNameKey, parseItemInput, toCanonical } from '../../../services/shopping/units'
import { requireHousehold, requireProfile } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const listId = getRouterParam(event, 'id')!
  const input = await readValidatedBody(event, shoppingItemCreateSchema.parse)
  const hh = requireHousehold()

  const list = useDb().select({ id: shoppingLists.id }).from(shoppingLists).where(and(
    eq(shoppingLists.id, listId),
    eq(shoppingLists.householdId, hh.id),
  )).get()
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  let { name } = input
  let displayQuantity = input.displayQuantity ?? null
  let quantity = input.quantity ?? null
  let unit = input.unit ?? null

  // Quick-add: "2 lbs chicken" typed straight into the name field.
  if (quantity == null && unit == null && displayQuantity == null) {
    const parsed = parseItemInput(name)
    name = parsed.name
    quantity = parsed.quantity
    unit = parsed.unit
    displayQuantity = parsed.displayQuantity
  }

  // Store canonical quantity/unit (ml / g) so meal-plan generation can merge.
  const canonical = quantity != null ? toCanonical(quantity, unit) : null
  if (canonical) {
    displayQuantity ??= formatQuantity(canonical.amount, canonical.family)
    quantity = canonical.amount
    unit = canonical.family === 'volume' ? 'ml' : 'g'
  }
  else if (quantity != null && displayQuantity == null) {
    displayQuantity = unit ? `${formatCount(quantity)} ${unit}` : formatCount(quantity)
  }

  return useDb().insert(shoppingListItems).values({
    listId,
    name,
    displayQuantity,
    quantity,
    unit,
    category: input.category ?? categorize(normalizeNameKey(name)),
    createdByProfileId: profile.id,
  }).returning().get()
})
