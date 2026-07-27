import { useDb } from '../../../db/client'
import { deleteAccount } from '../../../services/finance/accounts'
import { requireFinanceOwner } from '../../../services/finance/access'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceOwner(event)
  const household = requireHousehold()
  deleteAccount(useDb(), household.id, getRouterParam(event, 'id')!)
  return { ok: true }
})
