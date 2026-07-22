import { profileCreateSchema } from '#shared/schemas/profiles'
import { useDb } from '../../db/client'
import { profiles } from '../../db/schema'
import { requireAdmin, requireHousehold } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const input = await readValidatedBody(event, profileCreateSchema.parse)
  const hh = requireHousehold()

  return useDb().insert(profiles).values({
    householdId: hh.id,
    name: input.name,
    color: input.color,
    role: input.role,
    sortOrder: input.sortOrder ?? 99,
  }).returning().get()
})
