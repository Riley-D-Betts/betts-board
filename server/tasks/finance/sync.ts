import { useDb } from '../../db/client'
import { connectionsDue, syncConnection } from '../../services/finance/sync'
import { pruneExpiredFinanceSessions } from '../../services/finance/access'

// Hourly tick (nuxt.config scheduledTasks); each connection has its own
// interval, 6 hours by default. SimpleFIN bridges refresh from banks a few
// times a day, so polling every 15 minutes buys nothing and burns rate limit.
//
// The coarse-tick + per-row-due-predicate shape follows ics:refresh, but the
// due predicate here reads nextAttemptAt, which the backoff maintains.
export default defineTask({
  meta: { name: 'finance:sync', description: 'Sync due bank connections' },
  async run() {
    const db = useDb()
    pruneExpiredFinanceSessions()

    const due = connectionsDue(db)
    let synced = 0
    for (const connection of due) {
      // syncConnection never throws; this is belt-and-braces so a bug in it
      // still can't take down the scheduler tick for every other connection.
      try {
        await syncConnection(db, connection)
        synced++
      }
      catch (error) {
        console.error('[betts-board] finance sync failed for a connection:', (error as Error)?.message)
      }
    }
    return { result: synced }
  },
})
