import { useDb } from '../../../db/client'
import { listAccounts, netWorthByCurrency } from '../../../services/finance/accounts'
import { requireFinanceAccess } from '../../../services/finance/access'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  return {
    accounts: listAccounts(useDb(), household.id),
    netWorth: netWorthByCurrency(useDb(), household.id),
  }
})
