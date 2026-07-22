import { recipeImportSchema } from '#shared/schemas/recipes'
import { useDb } from '../../db/client'
import { importRecipeFromUrl } from '../../services/recipes/fetch'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const { url } = await readValidatedBody(event, recipeImportSchema.parse)
  const hh = requireHousehold()
  return importRecipeFromUrl(useDb(), { householdId: hh.id, url, profileId: profile.id })
})
