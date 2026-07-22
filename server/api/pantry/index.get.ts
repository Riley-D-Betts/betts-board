import { and, asc, eq, like } from 'drizzle-orm'
import { pantryQuerySchema } from '#shared/schemas/pantry'
import { useDb } from '../../db/client'
import { pantryItems } from '../../db/schema'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const { q } = await getValidatedQuery(event, pantryQuerySchema.parse)
  const hh = requireHousehold()

  return useDb().select().from(pantryItems).where(and(
    eq(pantryItems.householdId, hh.id),
    ...(q ? [like(pantryItems.name, `%${q}%`)] : []),
  )).orderBy(asc(pantryItems.category), asc(pantryItems.name)).all()
})
