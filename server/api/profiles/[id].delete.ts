import { eq } from 'drizzle-orm'
import { useDb } from '../../db/client'
import { profiles } from '../../db/schema'
import { requireAdmin } from '../../utils/session'

// Archive, not hard-delete: completions/events keep their author.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const updated = useDb().update(profiles)
    .set({ archivedAt: new Date() })
    .where(eq(profiles.id, id))
    .returning()
    .get()
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })
  return { ok: true }
})
