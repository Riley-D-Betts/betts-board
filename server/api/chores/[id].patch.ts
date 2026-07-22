import { chorePatchSchema } from '#shared/schemas/chores'
import { useDb } from '../../db/client'
import { updateChore } from '../../services/chores/chores'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  if (profile.role === 'kid') throw createError({ statusCode: 403, statusMessage: 'Adults only' })
  const id = getRouterParam(event, 'id')!
  const patch = await readValidatedBody(event, chorePatchSchema.parse)
  const hh = requireHousehold()
  return updateChore(useDb(), hh.id, id, patch)
})
