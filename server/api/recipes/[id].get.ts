import { useDb } from '../../db/client'
import { getRecipe } from '../../services/recipes/recipes'
import { getBoardSession, requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const id = getRouterParam(event, 'id')!
  const hh = requireHousehold()
  const session = await getBoardSession(event)
  return getRecipe(useDb(), hh.id, id, session?.profileId)
})
