import { eq } from 'drizzle-orm'
import { profilePatchSchema } from '#shared/schemas/profiles'
import { useDb } from '../../db/client'
import { profiles } from '../../db/schema'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const patch = await readValidatedBody(event, profilePatchSchema.parse)

  const existing = useDb().select().from(profiles).where(eq(profiles.id, id)).get()
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })

  return useDb().update(profiles).set({
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.color !== undefined && { color: patch.color }),
    ...(patch.role !== undefined && { role: patch.role }),
    ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
    ...(patch.archived !== undefined && { archivedAt: patch.archived ? new Date() : null }),
  }).where(eq(profiles.id, id)).returning().get()
})
