import { eq } from 'drizzle-orm'
import { feedPatchSchema } from '#shared/schemas/events'
import { useDb } from '../../db/client'
import { calendarFeeds } from '../../db/schema'
import { toFeedDto } from '../../utils/dto'
import { requireAdmin } from '../../utils/session'

// Returns a DTO, not the row: `url` is the credential for a private calendar.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const patch = await readValidatedBody(event, feedPatchSchema.parse)

  const existing = useDb().select().from(calendarFeeds).where(eq(calendarFeeds.id, id)).get()
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Feed not found' })

  const updated = useDb().update(calendarFeeds).set({
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.url !== undefined && { url: patch.url }),
    ...(patch.color !== undefined && { color: patch.color }),
    ...(patch.fetchIntervalMinutes !== undefined && { fetchIntervalMinutes: patch.fetchIntervalMinutes }),
    ...(patch.enabled !== undefined && { enabled: patch.enabled }),
  }).where(eq(calendarFeeds.id, id)).returning().get()
  return toFeedDto(updated)
})
