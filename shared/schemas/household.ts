import { z } from 'zod'
import { zIanaTimezone, zTimeString } from './common'

export const slideshowSettingsSchema = z.object({
  idleMinutes: z.number().min(0.1).max(240),
  intervalSec: z.number().int().min(3).max(120),
  transition: z.enum(['fade', 'kenburns']),
  showWeather: z.boolean(),
  showAgenda: z.boolean(),
  showClock: z.boolean(),
})

/** Accents users can pick — Tailwind palette names Nuxt UI resolves at runtime. */
export const ACCENT_COLORS = [
  'green', 'blue', 'indigo', 'violet', 'fuchsia', 'rose', 'orange', 'amber', 'teal', 'cyan',
] as const

export const appearanceSchema = z.object({
  font: z.enum(['rounded', 'system', 'serif', 'mono', 'playful']),
  accentLight: z.enum(ACCENT_COLORS),
  accentDark: z.enum(ACCENT_COLORS),
})

export const householdPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  timezone: zIanaTimezone.optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  locationName: z.string().trim().max(200).nullable().optional(),
  settings: z.object({
    weekStartsOn: z.union([z.literal(0), z.literal(1)]),
    temperatureUnit: z.enum(['fahrenheit', 'celsius']),
    appearance: appearanceSchema,
    mealTimes: z.object({
      breakfast: zTimeString,
      lunch: zTimeString,
      dinner: zTimeString,
      snack: zTimeString,
    }),
    defaultCookProfileId: z.string().min(1).nullable(),
    slideshow: slideshowSettingsSchema,
  }).partial().optional(),
})

export type HouseholdPatch = z.infer<typeof householdPatchSchema>
