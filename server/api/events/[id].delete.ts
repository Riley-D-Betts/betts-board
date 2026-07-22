import { and, eq } from 'drizzle-orm'
import { eventDeleteSchema } from '#shared/schemas/events'
import { useDb } from '../../db/client'
import { events } from '../../db/schema'
import { deleteAll, deleteFuture, deleteThis } from '../../services/calendar/events'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, eventDeleteSchema.parse)
  const hh = requireHousehold()
  const db = useDb()

  const row = db.select().from(events)
    .where(and(eq(events.id, id), eq(events.householdId, hh.id)))
    .get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Event not found' })
  if (row.feedId) throw createError({ statusCode: 403, statusMessage: 'Feed events are read-only' })

  // Occurrence scopes only make sense on a recurring series.
  const scope = row.rrule ? body.scope : 'all'

  switch (scope) {
    case 'this':
      deleteThis(db, row, body.occurrenceStart!)
      break
    case 'future':
      deleteFuture(db, row, body.occurrenceStart!)
      break
    default:
      deleteAll(db, row)
  }
  return { ok: true }
})
