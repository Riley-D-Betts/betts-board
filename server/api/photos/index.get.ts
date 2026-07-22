import { photoListQuerySchema } from '#shared/schemas/photos'
import { useDb } from '../../db/client'
import { listPhotos, toPhotoDto } from '../../services/photos/store'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const { cursor, limit } = await getValidatedQuery(event, photoListQuerySchema.parse)
  const hh = requireHousehold()
  return listPhotos(useDb(), { householdId: hh.id, cursor, limit }).map(toPhotoDto)
})
