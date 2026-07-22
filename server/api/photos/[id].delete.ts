import { useDb } from '../../db/client'
import { deletePhoto } from '../../services/photos/store'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const hh = requireHousehold()
  return deletePhoto(useDb(), hh.id, id)
})
