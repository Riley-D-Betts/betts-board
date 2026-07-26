import { useDb } from '../../db/client'
import { getWishlist } from '../../services/wishlists/store'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  return getWishlist(useDb(), requireHousehold().id, getRouterParam(event, 'id')!)
})
