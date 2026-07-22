import { eq } from 'drizzle-orm'
import { feedCreateSchema } from '#shared/schemas/events'
import { useDb } from '../../db/client'
import { calendarFeeds } from '../../db/schema'
import { refreshFeed } from '../../services/ics/import'
import { requireAdmin, requireHousehold } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const input = await readValidatedBody(event, feedCreateSchema.parse)
  const hh = requireHousehold()
  const db = useDb()

  const feed = db.insert(calendarFeeds).values({
    householdId: hh.id,
    name: input.name,
    url: input.url,
    color: input.color,
    fetchIntervalMinutes: input.fetchIntervalMinutes,
  }).returning().get()

  // Immediate first fetch so the calendar fills in right away; a bad URL
  // shows up as lastStatus 'error' on the returned row instead of a 500.
  await refreshFeed(db, feed)

  return db.select().from(calendarFeeds).where(eq(calendarFeeds.id, feed.id)).get()
})
