import { useDb } from '../../db/client'
import { listChores } from '../../services/chores/chores'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const hh = requireHousehold()
  return listChores(useDb(), hh.id)
})
