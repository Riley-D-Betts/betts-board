import { calendarQuerySchema } from '#shared/schemas/events'
import { useDb } from '../../db/client'
import { expandEvents } from '../../services/calendar/expand'
import { getCookingOccurrences } from '../../services/meals/cooking'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  // includeChores is accepted for forward-compat but ignored here — the chores
  // board has its own endpoint.
  // The schema owns the window rules — ordering AND the maximum span. Both
  // live there so every caller of calendarQuerySchema (and the OpenAPI doc)
  // gets them, and so this route cannot be the place someone forgets the cap.
  const { start, end, profileIds } = await getValidatedQuery(event, calendarQuerySchema.parse)
  const hh = requireHousehold()

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
