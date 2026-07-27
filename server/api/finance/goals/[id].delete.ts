import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { deleteGoal } from '../../../services/finance/goals'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  deleteGoal(useDb(), requireHousehold().id, getRouterParam(event, 'id')!)
  return { ok: true }
})
