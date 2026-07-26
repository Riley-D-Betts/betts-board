import { DateTime } from 'luxon'
import { sunTimes } from './solar'

export interface TvThemeInput {
  timezone: string
  latitude: number | null
  longitude: number | null
  /** settings.tv.theme — missing on households created before this existed. */
  preference?: 'auto' | 'light' | 'dark'
}

export interface TvThemeResult {
  theme: 'light' | 'dark'
  /** Epoch ms of the next scheduled flip; the client sleeps until then. */
  nextChangeAt: number
  /** How the answer was reached — surfaced in settings so it isn't a mystery. */
  source: 'forced' | 'solar' | 'clock'
}

/** Fallback daylight window when the household has no location set. */
const CLOCK_LIGHT_START_HOUR = 7
const CLOCK_LIGHT_END_HOUR = 19

/**
 * Resolves the wall display's theme. Pure: no network, no DB, no clock of its
 * own — pass `now` in so it's testable and so the caller controls the instant.
 */
export function resolveTvTheme(input: TvThemeInput, now: Date): TvThemeResult {
  const preference = input.preference ?? 'auto'
  const zone = input.timezone || 'UTC'

  // Forced light/dark still needs a nextChangeAt so the client's timer logic
  // has one shape; next local midnight is a harmless re-check point.
  if (preference !== 'auto') {
    return {
      theme: preference,
      nextChangeAt: nextMidnight(now, zone),
      source: 'forced',
    }
  }

  if (input.latitude != null && input.longitude != null) {
    return solarTheme(input.latitude, input.longitude, zone, now)
  }

  // No location configured: a plain wall-clock window. Deterministic, and it
  // can't get stuck the way a failed network lookup could.
  const local = DateTime.fromJSDate(now, { zone })
  const light = local.hour >= CLOCK_LIGHT_START_HOUR && local.hour < CLOCK_LIGHT_END_HOUR
  const nextBoundary = light
    ? local.set({ hour: CLOCK_LIGHT_END_HOUR, minute: 0, second: 0, millisecond: 0 })
    : local.hour < CLOCK_LIGHT_START_HOUR
      ? local.set({ hour: CLOCK_LIGHT_START_HOUR, minute: 0, second: 0, millisecond: 0 })
      : local.plus({ days: 1 }).set({ hour: CLOCK_LIGHT_START_HOUR, minute: 0, second: 0, millisecond: 0 })

  return { theme: light ? 'light' : 'dark', nextChangeAt: nextBoundary.toMillis(), source: 'clock' }
}

function solarTheme(lat: number, lon: number, zone: string, now: Date): TvThemeResult {
  const today = sunTimes(lat, lon, now)

  if (today.kind === 'polar-day') {
    return { theme: 'light', nextChangeAt: nextMidnight(now, zone), source: 'solar' }
  }
  if (today.kind === 'polar-night') {
    return { theme: 'dark', nextChangeAt: nextMidnight(now, zone), source: 'solar' }
  }

  if (now < today.sunrise) {
    // Still dark before dawn.
    return { theme: 'dark', nextChangeAt: today.sunrise.getTime(), source: 'solar' }
  }
  if (now < today.sunset) {
    return { theme: 'light', nextChangeAt: today.sunset.getTime(), source: 'solar' }
  }

  // After sunset: dark until tomorrow's sunrise.
  const tomorrow = sunTimes(lat, lon, new Date(now.getTime() + 86_400_000))
  const nextChangeAt = tomorrow.kind === 'normal'
    ? tomorrow.sunrise.getTime()
    : nextMidnight(now, zone)
  return { theme: 'dark', nextChangeAt, source: 'solar' }
}

function nextMidnight(now: Date, zone: string): number {
  return DateTime.fromJSDate(now, { zone }).plus({ days: 1 }).startOf('day').toMillis()
}
