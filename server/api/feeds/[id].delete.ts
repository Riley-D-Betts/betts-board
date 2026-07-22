import { eq } from 'drizzle-orm'
import { useDb } from '../../db/client'
import { calendarFeeds } from '../../db/schema'
import { requireAdmin } from '../../utils/session'

// Deleting the feed cascades to its imported events (FK onDelete) and,
// through those, to their exception rows.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const deleted = useDb().delete(calendarFeeds)
    .where(eq(calendarFeeds.id, id))
    .returning()
    .get()
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Feed not found' })
  return { ok: true }
})
