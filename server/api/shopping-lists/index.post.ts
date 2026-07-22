import { eq, sql } from 'drizzle-orm'
import { shoppingListCreateSchema } from '#shared/schemas/shopping'
import { useDb } from '../../db/client'
import { shoppingLists } from '../../db/schema'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const input = await readValidatedBody(event, shoppingListCreateSchema.parse)
  const hh = requireHousehold()

  const existing = useDb().select({ n: sql<number>`count(*)` }).from(shoppingLists)
    .where(eq(shoppingLists.householdId, hh.id)).get()
  const isDefault = input.isDefault || !existing?.n // the first list becomes the default

  if (isDefault) {
    useDb().update(shoppingLists).set({ isDefault: false })
      .where(eq(shoppingLists.householdId, hh.id)).run()
  }

  return useDb().insert(shoppingLists).values({
    householdId: hh.id,
    name: input.name,
    isDefault,
  }).returning().get()
})
