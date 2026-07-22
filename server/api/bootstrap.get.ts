import { asc, eq, isNull } from 'drizzle-orm'
import { useDb } from '../db/client'
import { profiles } from '../db/schema'
import { getBoardSession, getHousehold } from '../utils/session'

// Public: tells the client what stage the app is in and (once set up)
// the profile roster for the picker. Never leaks secrets.
export default defineEventHandler(async (event) => {
  const household = getHousehold()
  if (!household) return { needsSetup: true as const }

  const session = await getBoardSession(event)
  const roster = useDb()
    .select({
      id: profiles.id,
      name: profiles.name,
      color: profiles.color,
      avatarPath: profiles.avatarPath,
      role: profiles.role,
    })
    .from(profiles)
    .where(isNull(profiles.archivedAt))
    .orderBy(asc(profiles.sortOrder), asc(profiles.createdAt))
    .all()

  return {
    needsSetup: false as const,
    householdName: household.name,
    needsPasswordReset: household.passwordHash === '',
    unlocked: !!session,
    activeProfileId: session?.profileId ?? null,
    profiles: roster,
    settings: household.settings,
    timezone: household.timezone,
    hasLocation: household.latitude != null && household.longitude != null,
  }
})
