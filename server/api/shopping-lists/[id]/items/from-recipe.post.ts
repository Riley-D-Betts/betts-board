import { addFromRecipeSchema } from '#shared/schemas/shopping'
import { useDb } from '../../../../db/client'
import { addRecipeItems } from '../../../../services/shopping/addRecipeItems'
import { requireHousehold, requireProfile } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const input = await readValidatedBody(event, addFromRecipeSchema.parse)
  const hh = requireHousehold()

  return addRecipeItems(useDb(), {
    householdId: hh.id,
    // 'default' targets the default list (created as "Groceries" when missing).
    listId: id === 'default' ? undefined : id,
    recipeId: input.recipeId,
    ingredientIds: input.ingredientIds,
    scale: input.scale,
    createdByProfileId: profile.id,
  })
})
