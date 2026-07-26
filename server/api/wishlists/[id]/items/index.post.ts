import { wishlistItemCreateSchema } from '#shared/schemas/wishlists'
import { useDb } from '../../../../db/client'
import { addItem, canEditList, requireList } from '../../../../services/wishlists/store'
import { requireHousehold, requireProfile } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const listId = getRouterParam(event, 'id')!
  const householdId = requireHousehold().id
  const body = await readValidatedBody(event, wishlistItemCreateSchema.parse)

  const list = requireList(useDb(), householdId, listId)
  if (!canEditList(list, profile)) {
    throw createError({ statusCode: 403, statusMessage: "That's someone else's wish list" })
  }
  return addItem(useDb(), householdId, listId, body, profile.id)
})
