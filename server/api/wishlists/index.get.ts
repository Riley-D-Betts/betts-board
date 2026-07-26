import { useDb } from '../../db/client'
import { listWishlists } from '../../services/wishlists/store'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  return listWishlists(useDb(), requireHousehold().id)
})
