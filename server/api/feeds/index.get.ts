import { asc, eq } from 'drizzle-orm'
import { useDb } from '../../db/client'
import { calendarFeeds } from '../../db/schema'
import { toFeedDto } from '../../utils/dto'
import { requireHousehold, requireUnlocked } from '../../utils/session'

// Any unlocked session reaches this list, kid profiles included, so it must not
// carry the subscription URLs: for a private Google/Apple calendar that URL is
// the credential. toFeedDto keeps the host for recognition and drops the rest.
export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const hh = requireHousehold()
  return useDb()
    .select()
    .from(calendarFeeds)
    .where(eq(calendarFeeds.householdId, hh.id))
    .orderBy(asc(calendarFeeds.createdAt))
    .all()
    .map(toFeedDto)
})
