import { eq } from 'drizzle-orm'
import { switchProfileSchema } from '#shared/schemas/auth'
import { useDb } from '../../db/client'
import { profiles } from '../../db/schema'
import { lockFinance } from '../../services/finance/access'
import { requireUnlocked, setBoardSession } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const session = await requireUnlocked(event)
  const { profileId } = await readValidatedBody(event, switchProfileSchema.parse)

  const profile = useDb().select().from(profiles).where(eq(profiles.id, profileId)).get()
  if (!profile || profile.archivedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Profile not found' })
  }

  // Changing who is acting ends this device's Money session, because switching
  // profiles takes no credential at all. `getFinanceAccess` already refuses a
  // claim bound to someone else, but the finance_sessions row outlives the
  // switch — so a kid handed the tablet could tap their own face, then tap Dad
  // back, and walk into Money without ever meeting the PIN. Deleting the row
  // (lockFinance) is what actually revokes it; the cookie claim is inert
  // without it. This is the behaviour the README promises: "Switching profiles
  // drops it."
  if (session.profileId !== profile.id) await lockFinance(event)

  await setBoardSession(event, {
    ...session,
    profileId: profile.id,
    role: profile.role,
  })
  return { ok: true, profileId: profile.id }
})
