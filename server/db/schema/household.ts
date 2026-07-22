import { sqliteTable, text, real } from 'drizzle-orm/sqlite-core'
import { id, createdAt } from './_helpers'

export interface HouseholdSettings {
  weekStartsOn: 0 | 1
  /** Missing on rows created before the setting existed → treat as fahrenheit. */
  temperatureUnit?: 'fahrenheit' | 'celsius'
  /** Missing on older rows → defaults (rounded font, green accent both modes). */
  appearance?: {
    font: 'rounded' | 'system' | 'serif' | 'mono' | 'playful'
    accentLight: string // Tailwind palette name, e.g. 'green', 'violet'
    accentDark: string
  }
  slideshow: {
    idleMinutes: number
    intervalSec: number
    transition: 'fade' | 'kenburns'
    showWeather: boolean
    showAgenda: boolean
    showClock: boolean
  }
}

export const defaultHouseholdSettings: HouseholdSettings = {
  weekStartsOn: 0,
  temperatureUnit: 'fahrenheit',
  appearance: { font: 'rounded', accentLight: 'green', accentDark: 'green' },
  slideshow: {
    idleMinutes: 10,
    intervalSec: 12,
    transition: 'kenburns',
    showWeather: true,
    showAgenda: true,
    showClock: true,
  },
}

// Single row in v1, but everything is keyed by householdId so multi-household
// support later is a query change, not a migration.
export const households = sqliteTable('households', {
  id: id(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  locationName: text('location_name'),
  icsToken: text('ics_token').notNull(),
  vapidPublicKey: text('vapid_public_key'),
  vapidPrivateKey: text('vapid_private_key'),
  settings: text('settings', { mode: 'json' }).$type<HouseholdSettings>().notNull(),
  createdAt: createdAt(),
})
