import { financeTransactionQuerySchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { listTransactions } from '../../../services/finance/transactions'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const query = await getValidatedQuery(event, financeTransactionQuerySchema.parse)
  return listTransactions(useDb(), household.id, query)
})
