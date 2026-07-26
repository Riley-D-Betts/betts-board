import { useDb } from '../../db/client'
import { archiveWishlist, canEditList, requireList } from '../../services/wishlists/store'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const householdId = requireHousehold().id

  const list = requireList(useDb(), householdId, id)
  if (!canEditList(list, profile)) {
    throw createError({ statusCode: 403, statusMessage: "That's someone else's wish list" })
  }
  return archiveWishlist(useDb(), householdId, id)
})
