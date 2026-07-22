import { rewardPatchSchema } from '#shared/schemas/rewards'
import { useDb } from '../../db/client'
import { updateReward } from '../../services/rewards/store'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  if (profile.role === 'kid') throw createError({ statusCode: 403, statusMessage: 'Adults only' })
  const id = getRouterParam(event, 'id')!
  const patch = await readValidatedBody(event, rewardPatchSchema.parse)
  const hh = requireHousehold()
  return updateReward(useDb(), hh.id, id, patch)
})
