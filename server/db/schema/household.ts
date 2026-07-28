import { sqliteTable, text, real } from 'drizzle-orm/sqlite-core'
import type { HouseholdSettings } from '#shared/schemas/household'
import { DEFAULT_LOCALE } from '#shared/schemas/locales'
import { id, createdAt } from './_helpers'

// The settings shape lives in #shared/schemas/household (one source of truth for
// the zod validator, this column's type, and the client bootstrap type).
export type { HouseholdSettings }

export const defaultHouseholdSettings: HouseholdSettings = {
  weekStartsOn: 0,
  locale: DEFAULT_LOCALE,
  temperatureUnit: 'fahrenheit',
  appearance: { font: 'rounded', accentLight: 'green', accentDark: 'green', customFont: null },
  mealTimes: { breakfast: '07:30', lunch: '12:00', dinner: '18:00', snack: '15:00' },
  tv: { theme: 'auto' },
  finance: { currency: 'USD', forecastDays: 90 },
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
  // In-app feedback → GitHub issues. Repo "owner/name"; token is a
  // fine-grained PAT with issues:write, entered by the admin in Settings.
  githubRepo: text('github_repo'),
  githubToken: text('github_token'),
  settings: text('settings', { mode: 'json' }).$type<HouseholdSettings>().notNull(),
  createdAt: createdAt(),
})
