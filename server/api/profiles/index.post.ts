import { profileCreateSchema } from '#shared/schemas/profiles'
import { useDb } from '../../db/client'
import { createProfile } from '../../services/profiles/store'
import { requireAdmin, requireHousehold } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const input = await readValidatedBody(event, profileCreateSchema.parse)
  const hh = requireHousehold()
  return createProfile(useDb(), hh.id, input)
})
