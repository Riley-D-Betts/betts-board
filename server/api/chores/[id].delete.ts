import { useDb } from '../../db/client'
import { archiveChore } from '../../services/chores/chores'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  if (profile.role === 'kid') throw createError({ statusCode: 403, statusMessage: 'Adults only' })
  const id = getRouterParam(event, 'id')!
  const hh = requireHousehold()
  return archiveChore(useDb(), hh.id, id)
})
