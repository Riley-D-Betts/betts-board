import { eventCreateSchema } from '#shared/schemas/events'
import { useDb } from '../../db/client'
import { createEvent } from '../../services/calendar/events'
import { requireHousehold, requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  const input = await readValidatedBody(event, eventCreateSchema.parse)
  const hh = requireHousehold()

  return createEvent(useDb(), hh.id, input, profile.id)
})
