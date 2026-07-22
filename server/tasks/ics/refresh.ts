import { eq } from 'drizzle-orm'
import { useDb } from '../../db/client'
import { calendarFeeds } from '../../db/schema'
import { refreshFeed } from '../../services/ics/import'

// Scheduled every 15 minutes (nuxt.config scheduledTasks). Each feed only
// actually refetches once its own fetchIntervalMinutes has elapsed.
export default defineTask({
  meta: { name: 'ics:refresh', description: 'Refresh due ICS calendar subscriptions' },
  async run() {
    const db = useDb()
    const feeds = db.select().from(calendarFeeds)
      .where(eq(calendarFeeds.enabled, true))
      .all()

    const now = Date.now()
    let refreshed = 0
    for (const feed of feeds) {
      const due = !feed.lastFetchedAt
        || now - feed.lastFetchedAt.getTime() >= feed.fetchIntervalMinutes * 60_000
      if (!due) continue
      await refreshFeed(db, feed)
      refreshed++
    }
    return { result: refreshed }
  },
})
