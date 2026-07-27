import { z } from 'zod'
import { zIanaTimezone, zTimeString } from './common'
import { customFontSchema, zFontChoice } from './fonts'
import { zLocaleCode } from './locales'

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
  font: zFontChoice,
  accentLight: z.enum(ACCENT_COLORS),
  accentDark: z.enum(ACCENT_COLORS),
  /** Set once a Google Font has been downloaded; `font: 'custom'` selects it. */
  customFont: customFontSchema.nullish(),
})

export const tvSettingsSchema = z.object({
  /** auto = light between sunrise and sunset at the household location. */
  theme: z.enum(['auto', 'light', 'dark']),
})

export const financeSettingsSchema = z.object({
  /**
   * Display default only. Each account carries its own currency (SimpleFIN
   * reports per-account, and mixed-currency households are real), and totals
   * are grouped by currency rather than converted — there is no FX anywhere.
   */
  currency: z.string().trim().min(1).max(120),
  /** Days of cash-flow projection on the finance overview. */
  forecastDays: z.number().int().min(7).max(365),
})

/**
 * THE household settings contract. The DB column type, the client bootstrap
 * type, and the PATCH validator all derive from this — keep it the only place
 * the shape is written down.
 *
 * Fields added after v1 are `.optional()` because existing rows are not
 * migrated (settings is a JSON column); read them with a default.
 */
export const householdSettingsSchema = z.object({
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  /**
   * The board's language, household-wide rather than per-device.
   *
   * A kitchen wall tablet is shared, and a per-device language would mean the
   * same board reads differently depending on who last touched which screen.
   * Missing on rows created before the setting existed → English.
   */
  locale: zLocaleCode.optional(),
  /** Missing on rows created before the setting existed → treat as fahrenheit. */
  temperatureUnit: z.enum(['fahrenheit', 'celsius']).optional(),
  /** Pre-filled cook for newly planned meals; null = ask every time. */
  defaultCookProfileId: z.string().min(1).nullable().optional(),
  /** Wall-clock meal times (HH:MM); cooking blocks end at these. */
  mealTimes: z.object({
    breakfast: zTimeString,
    lunch: zTimeString,
    dinner: zTimeString,
    snack: zTimeString,
  }).optional(),
  appearance: appearanceSchema.optional(),
  tv: tvSettingsSchema.optional(),
  finance: financeSettingsSchema.optional(),
  slideshow: slideshowSettingsSchema,
})

export type HouseholdSettings = z.infer<typeof householdSettingsSchema>

export const householdPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  timezone: zIanaTimezone.optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  locationName: z.string().trim().max(200).nullable().optional(),
  // Deep-partial: every nested object may be patched a key at a time. The
  // route merges recursively, so a partial patch never clobbers siblings.
  settings: z.object({
    weekStartsOn: householdSettingsSchema.shape.weekStartsOn.optional(),
    locale: zLocaleCode.optional(),
    temperatureUnit: z.enum(['fahrenheit', 'celsius']).optional(),
    defaultCookProfileId: z.string().min(1).nullable().optional(),
    mealTimes: z.object({
      breakfast: zTimeString,
      lunch: zTimeString,
      dinner: zTimeString,
      snack: zTimeString,
    }).partial().optional(),
    appearance: appearanceSchema.partial().optional(),
    tv: tvSettingsSchema.partial().optional(),
    finance: financeSettingsSchema.partial().optional(),
    slideshow: slideshowSettingsSchema.partial().optional(),
  }).partial().optional(),
})

export type HouseholdPatch = z.infer<typeof householdPatchSchema>
