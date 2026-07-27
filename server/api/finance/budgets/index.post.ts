import { financeBudgetSetSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { setBudget } from '../../../services/finance/budgets'
import { financeCurrency } from '../../../services/finance/settings'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const body = await readValidatedBody(event, financeBudgetSetSchema.parse)
  return setBudget(useDb(), household.id, { ...body, currency: financeCurrency(household).currency })
})
