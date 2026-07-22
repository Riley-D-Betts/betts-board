import { eq } from 'drizzle-orm'
import { switchProfileSchema } from '#shared/schemas/auth'
import { useDb } from '../../db/client'
import { profiles } from '../../db/schema'
import { requireUnlocked, setBoardSession } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const session = await requireUnlocked(event)
  const { profileId } = await readValidatedBody(event, switchProfileSchema.parse)

  const profile = useDb().select().from(profiles).where(eq(profiles.id, profileId)).get()
  if (!profile || profile.archivedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Profile not found' })
  }

  await setBoardSession(event, {
    ...session,
    profileId: profile.id,
    role: profile.role,
  })
  return { ok: true, profileId: profile.id }
})
