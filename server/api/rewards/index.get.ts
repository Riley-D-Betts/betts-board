import { useDb } from '../../db/client'
import { getBalances, listRedemptions, listRewards } from '../../services/rewards/store'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const hh = requireHousehold()
  const db = useDb()
  return {
    rewards: listRewards(db, hh.id),
    balances: getBalances(db, hh.id),
    recent: listRedemptions(db, { householdId: hh.id }),
  }
})
