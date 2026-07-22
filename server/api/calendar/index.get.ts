import { calendarQuerySchema } from '#shared/schemas/events'
import { useDb } from '../../db/client'
import { expandEvents } from '../../services/calendar/expand'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  // includeChores is accepted for forward-compat but ignored here — the chores
  // board has its own endpoint.
  const { start, end, profileIds } = await getValidatedQuery(event, calendarQuerySchema.parse)
  const hh = requireHousehold()

  if (end <= start) {
    throw createError({ statusCode: 400, statusMessage: 'end must be after start' })
  }

  const ids = profileIds?.split(',').map(s => s.trim()).filter(Boolean)

  return expandEvents(useDb(), {
    householdId: hh.id,
    windowStartMs: start,
    windowEndMs: end,
    timezone: hh.timezone,
    profileIds: ids?.length ? ids : undefined,
  })
})
