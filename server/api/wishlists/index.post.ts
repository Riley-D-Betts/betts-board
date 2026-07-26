import { wishlistCreateSchema } from '#shared/schemas/wishlists'
import { useDb } from '../../db/client'
import { createWishlist } from '../../services/wishlists/store'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const body = await readValidatedBody(event, wishlistCreateSchema.parse)
  // Kids may only create their own list.
  if (profile.role === 'kid' && body.profileId && body.profileId !== profile.id) {
    throw createError({ statusCode: 403, statusMessage: 'You can only make your own wish list' })
  }
  return createWishlist(useDb(), requireHousehold().id, body, profile.id)
})
