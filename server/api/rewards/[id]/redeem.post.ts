import { redeemSchema } from '#shared/schemas/rewards'
import { useDb } from '../../../db/client'
import { redeem } from '../../../services/rewards/store'
import { requireProfile } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const rewardId = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, redeemSchema.parse)

  // Kids may only spend their own stars; adults can redeem on a kid's behalf.
  const profileId = body.profileId ?? profile.id
  if (profile.role === 'kid' && profileId !== profile.id) {
    throw createError({ statusCode: 403, statusMessage: 'You can only spend your own stars' })
  }

  return redeem(useDb(), { rewardId, profileId })
})
