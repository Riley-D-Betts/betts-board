import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { deleteTransaction } from '../../../services/finance/transactions'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  deleteTransaction(useDb(), household.id, getRouterParam(event, 'id')!)
  return { ok: true }
})
