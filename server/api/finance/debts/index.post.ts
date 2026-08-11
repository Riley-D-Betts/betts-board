import { financeDebtCreateSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { createDebt } from '../../../services/finance/debts'
import { financeCurrency } from '../../../services/finance/settings'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const body = await readValidatedBody(event, financeDebtCreateSchema.parse)
  return createDebt(useDb(), household.id, { ...body, currency: financeCurrency(household).currency })
})
