import { useDb } from '../../db/client'
import { requireDeletablePhoto } from '../../services/photos/access'
import { deletePhoto } from '../../services/photos/store'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const hh = requireHousehold()
  // Irreversible — row and both files. See server/services/photos/access.ts
  // for who is allowed to do it and why it isn't every profile.
  requireDeletablePhoto(useDb(), hh.id, id, profile)
  return deletePhoto(useDb(), hh.id, id)
})
