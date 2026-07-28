import { eq } from 'drizzle-orm'
import { useDb } from '../../../db/client'
import { calendarFeeds } from '../../../db/schema'
import { refreshFeed } from '../../../services/ics/import'
import { toFeedDto } from '../../../utils/dto'
import { requireAdmin } from '../../../utils/session'

// The client reads lastStatus/lastError off this response; it has never needed
// `url`, which for a private calendar is the credential itself.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb()

  const feed = db.select().from(calendarFeeds).where(eq(calendarFeeds.id, id)).get()
  if (!feed) throw createError({ statusCode: 404, statusMessage: 'Feed not found' })

  await refreshFeed(db, feed)
  // Re-read: refreshFeed writes lastFetchedAt/lastStatus/lastError.
  return toFeedDto(db.select().from(calendarFeeds).where(eq(calendarFeeds.id, id)).get()!)
})
