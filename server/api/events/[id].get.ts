import { and, count, eq } from 'drizzle-orm'
import { useDb } from '../../db/client'
import { calendarFeeds, eventAttendees, eventExceptions, events } from '../../db/schema'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const hh = requireHousehold()
  const db = useDb()

  const row = db.select().from(events)
    .where(and(eq(events.id, id), eq(events.householdId, hh.id)))
    .get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Event not found' })

  const attendeeProfileIds = db.select({ profileId: eventAttendees.profileId })
    .from(eventAttendees)
    .where(eq(eventAttendees.eventId, id))
    .all()
    .map(a => a.profileId)

  const exceptionsCount = db.select({ n: count() }).from(eventExceptions)
    .where(eq(eventExceptions.eventId, id))
    .get()?.n ?? 0

  const feedName = row.feedId
    ? db.select({ name: calendarFeeds.name }).from(calendarFeeds)
        .where(eq(calendarFeeds.id, row.feedId)).get()?.name ?? null
    : null

  return { ...row, attendeeProfileIds, exceptionsCount, feedName }
})
