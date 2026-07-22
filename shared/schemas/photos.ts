import { z } from 'zod'

export const photoPatchSchema = z.object({
  inSlideshow: z.boolean().optional(),
})

export const photoListQuerySchema = z.object({
  cursor: z.string().optional(), // last photo id of previous page
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export interface PhotoDto {
  id: string
  url: string
  thumbUrl: string
  width: number
  height: number
  takenAt: number | null
  uploadedAt: number
  inSlideshow: boolean
  uploadedByProfileId: string | null
}

export interface SlideshowManifest {
  photos: { id: string, url: string, width: number, height: number }[]
  settings: {
    intervalSec: number
    transition: 'fade' | 'kenburns'
    showWeather: boolean
    showAgenda: boolean
    showClock: boolean
    idleMinutes: number
  }
}
