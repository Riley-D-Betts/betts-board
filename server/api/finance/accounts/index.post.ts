import { financeAccountCreateSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { createAccount } from '../../../services/finance/accounts'
import { requireFinanceAccess } from '../../../services/finance/access'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const body = await readValidatedBody(event, financeAccountCreateSchema.parse)
  return createAccount(useDb(), household.id, body)
})
