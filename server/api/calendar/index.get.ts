import { calendarQuerySchema } from '#shared/schemas/events'
import { useDb } from '../../db/client'
import { expandEvents } from '../../services/calendar/expand'
import { getCookingOccurrences } from '../../services/meals/cooking'
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

  const occurrences = expandEvents(useDb(), {
    householdId: hh.id,
    windowStartMs: start,
    windowEndMs: end,
    timezone: hh.timezone,
    profileIds: ids?.length ? ids : undefined,
  })

  const cooking = getCookingOccurrences(useDb(), {
    householdId: hh.id,
    windowStartMs: start,
    windowEndMs: end,
    timezone: hh.timezone,
    mealTimes: hh.settings.mealTimes,
  }).filter(o => !ids?.length || o.attendees.some(a => ids.includes(a.profileId)))

  return [...occurrences, ...cooking].sort((a, b) =>
    a.start - b.start
    || Number(b.isAllDay) - Number(a.isAllDay)
    || a.title.localeCompare(b.title))
})
