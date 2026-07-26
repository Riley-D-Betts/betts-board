import { wishlistItemPatchSchema } from '#shared/schemas/wishlists'
import { useDb } from '../../../../db/client'
import { canEditList, requireList, updateItem } from '../../../../services/wishlists/store'
import { requireHousehold, requireProfile } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const listId = getRouterParam(event, 'id')!
  const itemId = getRouterParam(event, 'itemId')!
  const householdId = requireHousehold().id
  const patch = await readValidatedBody(event, wishlistItemPatchSchema.parse)

  const list = requireList(useDb(), householdId, listId)
  if (!canEditList(list, profile)) {
    throw createError({ statusCode: 403, statusMessage: "That's someone else's wish list" })
  }
  return updateItem(useDb(), householdId, listId, itemId, patch)
})
