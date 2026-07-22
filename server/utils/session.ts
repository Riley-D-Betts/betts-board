import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../db/client'
import { households, profiles } from '../db/schema'

export interface BoardSession {
  unlocked: boolean
  householdId: string
  profileId?: string
  role?: 'admin' | 'adult' | 'kid'
}

/** The single household row, or null before first-boot setup. */
export function getHousehold() {
  return useDb().select().from(households).limit(1).get() ?? null
}

export function requireHousehold() {
  const hh = getHousehold()
  if (!hh) throw createError({ statusCode: 409, statusMessage: 'Setup required' })
  return hh
}

export async function getBoardSession(event: H3Event): Promise<BoardSession | null> {
  // API-key requests: the auth middleware verified the bearer token and
  // stashed the resolved session on the event context.
  const apiSession = event.context.boardApiSession as BoardSession | undefined
  if (apiSession) return apiSession

  const session = await getUserSession(event)
  const data = session?.user as BoardSession | undefined
  return data?.unlocked ? data : null
}

export async function requireUnlocked(event: H3Event): Promise<BoardSession> {
  const s = await getBoardSession(event)
  if (!s) throw createError({ statusCode: 401, statusMessage: 'Locked' })
  return s
}

/** Session + an acting profile (most feature routes want this). */
export async function requireProfile(event: H3Event) {
  const s = await requireUnlocked(event)
  if (!s.profileId) throw createError({ statusCode: 403, statusMessage: 'No acting profile' })
  const profile = useDb().select().from(profiles).where(eq(profiles.id, s.profileId)).get()
  if (!profile || profile.archivedAt) throw createError({ statusCode: 403, statusMessage: 'Profile unavailable' })
  return { session: s, profile }
}

export async function requireAdmin(event: H3Event) {
  const { session, profile } = await requireProfile(event)
  if (profile.role !== 'admin') throw createError({ statusCode: 403, statusMessage: 'Admin only' })
  return { session, profile }
}

export async function setBoardSession(event: H3Event, data: BoardSession) {
  await setUserSession(event, { user: data })
}
