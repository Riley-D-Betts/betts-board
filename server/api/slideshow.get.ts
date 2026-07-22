import type { SlideshowManifest } from '#shared/schemas/photos'
import { useDb } from '../db/client'
import { listSlideshowPhotos, shuffle } from '../services/photos/store'
import { requireHousehold, requireUnlocked } from '../utils/session'

export default defineEventHandler(async (event): Promise<SlideshowManifest> => {
  await requireUnlocked(event)
  const hh = requireHousehold()

  return {
    photos: shuffle(listSlideshowPhotos(useDb(), hh.id)).map(p => ({
      id: p.id,
      url: `/uploads/${p.path}`, // full-size image, not the thumb
      width: p.width,
      height: p.height,
    })),
    settings: hh.settings.slideshow,
  }
})
