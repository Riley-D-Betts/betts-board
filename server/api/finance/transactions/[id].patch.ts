import { financeTransactionPatchSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { patchTransaction } from '../../../services/finance/transactions'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const body = await readValidatedBody(event, financeTransactionPatchSchema.parse)
  return patchTransaction(useDb(), household.id, getRouterParam(event, 'id')!, body)
})
