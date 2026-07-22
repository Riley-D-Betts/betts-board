import { leaderboardQuerySchema } from '#shared/schemas/chores'
import { useDb } from '../../db/client'
import { getLeaderboard } from '../../services/chores/scoring'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const { period } = await getValidatedQuery(event, leaderboardQuerySchema.parse)
  const hh = requireHousehold()
  return getLeaderboard(useDb(), { householdId: hh.id, period })
})
