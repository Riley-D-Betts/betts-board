import { asc, isNull } from 'drizzle-orm'
import type { HouseholdSettings } from '#shared/schemas/household'
import type { Db } from '../../db/client'
import type { households } from '../../db/schema'
import { profiles } from '../../db/schema'
import type { BoardSession } from '../../utils/session'

/**
 * The payload behind GET /api/bootstrap, which is PUBLIC — the auth middleware
 * lets it through unauthenticated, because the client has to know what stage
 * the app is in before it can render the lock screen.
 *
 * "Public" is the whole problem: some households put this board on the open
 * internet, so every field here is readable by anyone who finds the hostname.
 * The split below is therefore deliberate and the rule is one line long:
 *
 *   pre-unlock → only what the lock/setup screens actually paint;
 *   post-unlock → everything else.
 *
 * Pre-unlock that means the household name (the lock screen's nameplate, which
 * the family chose to show at the door), whether setup or a password reset is
 * pending, and `settings` — the lock screen has to come up in the household's
 * language and font, and settings holds no credentials.
 *
 * It does NOT include the profile roster. That used to ship to anybody: every
 * family member's name, avatar and role, which is a phishing kit and a
 * who-lives-here list for a stranger with a port scanner. The picker that
 * consumes it only ever renders after unlocking, so nothing is lost.
 */

export interface BootstrapNeedsSetup {
  needsSetup: true
}

export interface BootstrapLocked {
  needsSetup: false
  householdName: string
  needsPasswordReset: boolean
  unlocked: false
  settings: HouseholdSettings
}

export interface BootstrapProfile {
  id: string
  name: string
  color: string
  avatarPath: string | null
  role: 'admin' | 'adult' | 'kid'
}

export interface BootstrapUnlocked extends Omit<BootstrapLocked, 'unlocked'> {
  unlocked: true
  activeProfileId: string | null
  profiles: BootstrapProfile[]
  timezone: string
  hasLocation: boolean
}

export type BootstrapPayload = BootstrapNeedsSetup | BootstrapLocked | BootstrapUnlocked

export function buildBootstrap(
  db: Db,
  household: typeof households.$inferSelect | null,
  session: BoardSession | null,
): BootstrapPayload {
  if (!household) return { needsSetup: true }

  const locked: BootstrapLocked = {
    needsSetup: false,
    householdName: household.name,
    // Armed by the CLI recovery flow; the reset screen is pre-unlock by nature.
    needsPasswordReset: household.passwordHash === '',
    unlocked: false,
    settings: household.settings,
  }
  if (!session) return locked

  return {
    ...locked,
    unlocked: true,
    activeProfileId: session.profileId ?? null,
    profiles: db.select({
      id: profiles.id,
      name: profiles.name,
      color: profiles.color,
      avatarPath: profiles.avatarPath,
      role: profiles.role,
    })
      .from(profiles)
      .where(isNull(profiles.archivedAt))
      .orderBy(asc(profiles.sortOrder), asc(profiles.createdAt))
      .all(),
    timezone: household.timezone,
    hasLocation: household.latitude != null && household.longitude != null,
  }
}
