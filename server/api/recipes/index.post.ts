import { recipeCreateSchema } from '#shared/schemas/recipes'
import { useDb } from '../../db/client'
import { createRecipe } from '../../services/recipes/recipes'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const input = await readValidatedBody(event, recipeCreateSchema.parse)
  const hh = requireHousehold()
  return createRecipe(useDb(), hh.id, input, profile.id)
})
