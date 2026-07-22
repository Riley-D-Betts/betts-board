import { eq } from 'drizzle-orm'
import { useDb } from '../../../db/client'
import { calendarFeeds } from '../../../db/schema'
import { refreshFeed } from '../../../services/ics/import'
import { requireAdmin } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb()

  const feed = db.select().from(calendarFeeds).where(eq(calendarFeeds.id, id)).get()
  if (!feed) throw createError({ statusCode: 404, statusMessage: 'Feed not found' })

  await refreshFeed(db, feed)
  return db.select().from(calendarFeeds).where(eq(calendarFeeds.id, id)).get()
})
