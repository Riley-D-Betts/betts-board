import { useDb } from '../../../../db/client'
import { canEditList, deleteItem, requireList } from '../../../../services/wishlists/store'
import { requireHousehold, requireProfile } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const listId = getRouterParam(event, 'id')!
  const itemId = getRouterParam(event, 'itemId')!
  const householdId = requireHousehold().id

  const list = requireList(useDb(), householdId, listId)
  if (!canEditList(list, profile)) {
    throw createError({ statusCode: 403, statusMessage: "That's someone else's wish list" })
  }
  return deleteItem(useDb(), householdId, listId, itemId)
})
