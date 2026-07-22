import { recipeListQuerySchema } from '#shared/schemas/recipes'
import { useDb } from '../../db/client'
import { listRecipes } from '../../services/recipes/recipes'
import { getBoardSession, requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const query = await getValidatedQuery(event, recipeListQuerySchema.parse)
  const hh = requireHousehold()
  const session = await getBoardSession(event)
  return listRecipes(useDb(), hh.id, query, session?.profileId)
})
