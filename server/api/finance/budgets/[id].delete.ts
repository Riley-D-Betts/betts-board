import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { deleteBudget } from '../../../services/finance/budgets'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  deleteBudget(useDb(), requireHousehold().id, getRouterParam(event, 'id')!)
  return { ok: true }
})
