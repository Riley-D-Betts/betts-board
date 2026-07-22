import { rewardCreateSchema } from '#shared/schemas/rewards'
import { useDb } from '../../db/client'
import { createReward } from '../../services/rewards/store'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  if (profile.role === 'kid') throw createError({ statusCode: 403, statusMessage: 'Adults only' })
  const input = await readValidatedBody(event, rewardCreateSchema.parse)
  const hh = requireHousehold()
  return createReward(useDb(), hh.id, input)
})
