import { DateTime } from 'luxon'
import { choreBoardQuerySchema } from '#shared/schemas/chores'
import { useDb } from '../../db/client'
import { getChoreBoard } from '../../services/chores/board'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const query = await getValidatedQuery(event, choreBoardQuerySchema.parse)
  const hh = requireHousehold()
  const today = DateTime.now().setZone(hh.timezone).toISODate()!
  return getChoreBoard(useDb(), { householdId: hh.id, startDate: query.start, endDate: query.end, today })
})
