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
  const thisMonth = currentMonth(todayString())
  const period = periodStart ?? thisMonth
  const { currency } = financeCurrency(household)

  // Copy last month forward the first time the CURRENT month is opened, so the
  // screen isn't empty every 1st.
  //
  // Only the current month: a GET must not invent budget rows for whatever
  // period the client asks for. Browsing back through last year would
  // otherwise fabricate budgets for months that never had one — rewriting
  // history — and browsing forward would freeze a future month's budget at
  // today's numbers.
  if (period === thisMonth) carryForwardBudgets(useDb(), household.id, period)
  return budgetForMonth(useDb(), household.id, period, currency)
})
