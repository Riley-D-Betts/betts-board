import { useDb } from '../../db/client'
import { deleteRecipe } from '../../services/recipes/recipes'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const hh = requireHousehold()
  return deleteRecipe(useDb(), hh.id, id)
})
