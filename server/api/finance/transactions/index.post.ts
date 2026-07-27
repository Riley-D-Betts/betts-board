import { financeTransactionCreateSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { createTransaction } from '../../../services/finance/transactions'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { profile } = await requireFinanceAccess(event)
  const household = requireHousehold()
  const input = await readValidatedBody(event, financeTransactionCreateSchema.parse)
  return createTransaction(useDb(), { householdId: household.id, profileId: profile.id, input })
})
