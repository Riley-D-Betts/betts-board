import { financeBudgetQuerySchema } from '#shared/schemas/finance'
import { todayString } from '#shared/utils/dates'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { budgetForMonth, carryForwardBudgets, currentMonth } from '../../../services/finance/budgets'
import { financeCurrency } from '../../../services/finance/settings'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const { periodStart } = await getValidatedQuery(event, financeBudgetQuerySchema.parse)
  const period = periodStart ?? currentMonth(todayString())
  const { currency } = financeCurrency(household)

  // Copy last month forward the first time a month is opened, so the screen
  // isn't empty every 1st. Only fills gaps — never overwrites this month.
  carryForwardBudgets(useDb(), household.id, period)
  return budgetForMonth(useDb(), household.id, period, currency)
})
