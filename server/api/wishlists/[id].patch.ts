import { wishlistPatchSchema } from '#shared/schemas/wishlists'
import { useDb } from '../../db/client'
import { canEditList, requireList, updateWishlist } from '../../services/wishlists/store'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const householdId = requireHousehold().id
  const patch = await readValidatedBody(event, wishlistPatchSchema.parse)

  const list = requireList(useDb(), householdId, id)
  if (!canEditList(list, profile)) {
    throw createError({ statusCode: 403, statusMessage: "That's someone else's wish list" })
  }
  return updateWishlist(useDb(), householdId, id, patch)
})
