import { choreCreateSchema } from '#shared/schemas/chores'
import { useDb } from '../../db/client'
import { createChore } from '../../services/chores/chores'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  if (profile.role === 'kid') throw createError({ statusCode: 403, statusMessage: 'Adults only' })
  const input = await readValidatedBody(event, choreCreateSchema.parse)
  const hh = requireHousehold()
  return createChore(useDb(), hh.id, input, profile.id)
})
