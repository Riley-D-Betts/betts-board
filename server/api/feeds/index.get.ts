import { asc, eq } from 'drizzle-orm'
import { useDb } from '../../db/client'
import { calendarFeeds } from '../../db/schema'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const hh = requireHousehold()
  return useDb()
    .select()
    .from(calendarFeeds)
    .where(eq(calendarFeeds.householdId, hh.id))
    .orderBy(asc(calendarFeeds.createdAt))
    .all()
})
