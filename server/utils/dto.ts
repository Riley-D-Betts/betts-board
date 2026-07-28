import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { HouseholdSettings } from '#shared/schemas/household'
import type { calendarFeeds, households } from '../db/schema'
import { profiles } from '../db/schema'

/**
 * The single place where a database row becomes an API response.
 *
 * Three of our tables keep a credential in a column that sits right next to
 * the harmless ones:
 *   - `profiles.pinHash` — argon2 of the Money PIN. Anyone who can become
 *     admin (which costs one tap) could otherwise download the hash of a short
 *     numeric PIN and crack it offline, defeating the whole finance gate.
 *   - `calendar_feeds.url` — for a private Google/Apple calendar the
 *     subscription URL *is* the credential: whoever holds it reads that
 *     calendar forever, from anywhere, with no way to revoke it but deleting
 *     the calendar.
 *   - `households.passwordHash` / `icsToken` / `githubToken` /
 *     `vapidPrivateKey` — the household password, the un-authenticated ICS
 *     feed key, a GitHub PAT, and the push signing key.
 *
 * Drizzle's `select()` and `returning()` hand back *every* column, so a route
 * that returns a row publishes those too. That already happened: two sibling
 * routes returned profiles, one stripped `pinHash` by destructuring and the
 * other forgot.
 *
 * Everything here is therefore an ALLOWLIST — never `const { pinHash, ...rest
 * } = row`. A denylist is a promise to remember: it covers the secrets that
 * existed the day it was written and silently publishes the next secret column
 * somebody adds. An allowlist fails the safe way — a new column is invisible
 * until a human deliberately names it in this file.
 */

export interface ProfileDto {
  id: string
  householdId: string
  name: string
  color: string
  avatarPath: string | null
  role: 'admin' | 'adult' | 'kid'
  sortOrder: number
  archivedAt: Date | null
  createdAt: Date
}

/**
 * The public columns of `profiles`, shaped for `select()` / `returning()`.
 *
 * Prefer narrowing AT THE QUERY (`select(profileDtoColumns)`,
 * `returning(profileDtoColumns)`) over fetching the row and mapping it after
 * the fact: the PIN hash then never enters this process at all, so it cannot
 * escape through a log line, a thrown error's payload, a debugger session or a
 * `JSON.stringify` of some wrapper object. `toProfileDto` below exists only
 * for the paths that legitimately need the whole row first (PIN verification
 * in server/services/finance/access.ts) and then hand it outward.
 *
 * `satisfies` keeps this map and `ProfileDto` in lockstep: a missing key or an
 * extra one is a type error, so the two can never drift apart.
 */
export const profileDtoColumns = {
  id: profiles.id,
  householdId: profiles.householdId,
  name: profiles.name,
  color: profiles.color,
  avatarPath: profiles.avatarPath,
  role: profiles.role,
  sortOrder: profiles.sortOrder,
  archivedAt: profiles.archivedAt,
  createdAt: profiles.createdAt,
} satisfies Record<keyof ProfileDto, SQLiteColumn>

/** Row → response for code that already holds a full profile row. */
export function toProfileDto(row: typeof profiles.$inferSelect): ProfileDto {
  return {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    color: row.color,
    avatarPath: row.avatarPath,
    role: row.role,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
  }
}

export interface FeedDto {
  id: string
  name: string
  color: string
  enabled: boolean
  fetchIntervalMinutes: number
  lastFetchedAt: Date | null
  lastStatus: 'ok' | 'error' | null
  lastError: string | null
  createdAt: Date
  /** Host only — see `toFeedDto`. Empty when the stored URL won't parse. */
  urlHost: string
}

/**
 * Host of a feed URL, for display. Never the path or query: for a private
 * Google/Apple calendar those carry the secret, and the host alone is enough
 * for a human to recognise which feed they are looking at.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  }
  catch {
    return ''
  }
}

/**
 * Row → response for calendar feeds.
 *
 * Unlike profiles this cannot be a narrow `select()`, because the host we show
 * is derived from the secret column itself; the mapping has to happen after
 * the read. Keeping the derivation here means no caller ever has a reason to
 * pass the raw row onward.
 */
export function toFeedDto(row: typeof calendarFeeds.$inferSelect): FeedDto {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    enabled: row.enabled,
    fetchIntervalMinutes: row.fetchIntervalMinutes,
    lastFetchedAt: row.lastFetchedAt,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    createdAt: row.createdAt,
    urlHost: hostOf(row.url),
  }
}

export interface HouseholdDto {
  id: string
  name: string
  timezone: string
  latitude: number | null
  longitude: number | null
  locationName: string | null
  settings: HouseholdSettings
  createdAt: Date
  /** Admins only — see `toHouseholdDto`. */
  icsToken?: string
}

/**
 * Row → response for the household.
 *
 * `icsToken` is opt-in and admin-only: it authenticates `/feeds/<token>.ics`,
 * a route with no session gate at all, so handing it to every unlocked
 * session (kid profiles, API keys bound to nobody) publishes the family's
 * whole calendar to anyone that token later reaches. Admins can rotate it —
 * see server/services/household/icsToken.ts.
 */
export function toHouseholdDto(
  row: typeof households.$inferSelect,
  viewer: { isAdmin: boolean },
): HouseholdDto {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    latitude: row.latitude,
    longitude: row.longitude,
    locationName: row.locationName,
    settings: row.settings,
    createdAt: row.createdAt,
    ...(viewer.isAdmin && { icsToken: row.icsToken }),
  }
}
