import { and, eq, isNull } from 'drizzle-orm'
import { apiKeyCreateSchema } from '#shared/schemas/apiKeys'
import { useDb } from '../../db/client'
import { profiles } from '../../db/schema'
import { createApiKey } from '../../services/apiKeys/keys'
import { requireAdmin, requireHousehold } from '../../utils/session'

// The response includes the bearer token — shown exactly once, never again.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const input = await readValidatedBody(event, apiKeyCreateSchema.parse)
  const hh = requireHousehold()

  // A bound acting profile must be a live member of this household.
  if (input.profileId) {
    const profile = useDb().select({ id: profiles.id }).from(profiles).where(and(
      eq(profiles.id, input.profileId),
      eq(profiles.householdId, hh.id),
      isNull(profiles.archivedAt),
    )).get()
    if (!profile) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })
  }

  return createApiKey(useDb(), {
    householdId: hh.id,
    name: input.name,
    profileId: input.profileId,
  })
})
