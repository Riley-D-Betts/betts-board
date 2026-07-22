import { photoPatchSchema } from '#shared/schemas/photos'
import { useDb } from '../../db/client'
import { getPhoto, setInSlideshow, toPhotoDto } from '../../services/photos/store'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const patch = await readValidatedBody(event, photoPatchSchema.parse)
  const hh = requireHousehold()

  if (patch.inSlideshow !== undefined) {
    return toPhotoDto(setInSlideshow(useDb(), hh.id, id, patch.inSlideshow))
  }
  const existing = getPhoto(useDb(), hh.id, id)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Photo not found' })
  return toPhotoDto(existing)
})
