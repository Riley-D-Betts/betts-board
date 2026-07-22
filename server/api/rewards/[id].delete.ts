import { useDb } from '../../db/client'
import { archiveReward } from '../../services/rewards/store'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  if (profile.role === 'kid') throw createError({ statusCode: 403, statusMessage: 'Adults only' })
  const id = getRouterParam(event, 'id')!
  const hh = requireHousehold()
  return archiveReward(useDb(), hh.id, id)
})
