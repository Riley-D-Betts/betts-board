import { recipeRatingSchema } from '#shared/schemas/recipes'
import { useDb } from '../../../db/client'
import { rateRecipe } from '../../../services/recipes/recipes'
import { requireHousehold, requireProfile } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const { rating } = await readValidatedBody(event, recipeRatingSchema.parse)
  const hh = requireHousehold()
  return rateRecipe(useDb(), hh.id, id, profile.id, rating)
})
