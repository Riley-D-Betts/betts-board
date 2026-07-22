import { z } from 'zod'
import { zIanaTimezone } from './common'

export const slideshowSettingsSchema = z.object({
  idleMinutes: z.number().min(0.1).max(240),
  intervalSec: z.number().int().min(3).max(120),
  transition: z.enum(['fade', 'kenburns']),
  showWeather: z.boolean(),
  showAgenda: z.boolean(),
  showClock: z.boolean(),
})

export const householdPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  timezone: zIanaTimezone.optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  locationName: z.string().trim().max(200).nullable().optional(),
  settings: z.object({
    weekStartsOn: z.union([z.literal(0), z.literal(1)]),
    slideshow: slideshowSettingsSchema,
  }).partial().optional(),
})

export type HouseholdPatch = z.infer<typeof householdPatchSchema>
