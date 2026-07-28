import { eq } from 'drizzle-orm'
import { feedCreateSchema } from '#shared/schemas/events'
import { useDb } from '../../db/client'
import { calendarFeeds } from '../../db/schema'
import { refreshFeed } from '../../services/ics/import'
import { toFeedDto } from '../../utils/dto'
import { requireAdmin, requireHousehold } from '../../utils/session'

// Echoing the row back would echo `url`, and for a private Google/Apple
// calendar that URL is the credential — same reason GET /api/feeds maps
// through toFeedDto. Admin-only is not a reason to hand it out again.
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

  // Re-read: refreshFeed writes lastStatus/lastError, which the caller wants.
  const stored = db.select().from(calendarFeeds).where(eq(calendarFeeds.id, feed.id)).get()!
  return toFeedDto(stored)
})
