import { financeAccountQuerySchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { listAccounts, netWorthByCurrency } from '../../../services/finance/accounts'
import { requireFinanceAccess } from '../../../services/finance/access'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const { includeArchived } = await getValidatedQuery(event, financeAccountQuerySchema.parse)
  return {
    accounts: listAccounts(useDb(), household.id, includeArchived),
    // Net worth deliberately ignores includeArchived: a hidden account is out
    // of the totals whichever list the caller asked for.
    netWorth: netWorthByCurrency(useDb(), household.id),
  }
})
