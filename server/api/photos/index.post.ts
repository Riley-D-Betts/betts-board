import type { PhotoDto } from '#shared/schemas/photos'
import { useDb } from '../../db/client'
import { savePhoto, toPhotoDto } from '../../services/photos/store'
import { requireHousehold, requireProfile } from '../../utils/session'

const MAX_FILE_BYTES = 25 * 1024 * 1024

// Some OS/browser combos send no MIME type for HEIC files — fall back to the
// extension. savePhoto still 415s anything that doesn't actually decode.
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i

export default defineEventHandler(async (event): Promise<PhotoDto[]> => {
  const { profile } = await requireProfile(event)
  const hh = requireHousehold()

  const parts = await readMultipartFormData(event)
  const files = (parts ?? []).filter(p => p.filename && p.data.length > 0)
  if (files.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No files uploaded' })
  }

  // Validate the whole batch before writing anything.
  for (const f of files) {
    if (f.data.length > MAX_FILE_BYTES) {
      throw createError({ statusCode: 413, statusMessage: `${f.filename} is larger than 25 MB` })
    }
    if (!f.type?.startsWith('image/') && !IMAGE_EXT.test(f.filename ?? '')) {
      throw createError({ statusCode: 415, statusMessage: `${f.filename} is not an image` })
    }
  }

  const saved: PhotoDto[] = []
  for (const f of files) {
    saved.push(toPhotoDto(await savePhoto(useDb(), {
      householdId: hh.id,
      profileId: profile.id,
      buffer: f.data,
      originalName: f.filename,
    })))
  }
  return saved
})
