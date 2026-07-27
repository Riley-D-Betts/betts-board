import { financeForecastQuerySchema } from '#shared/schemas/finance'
import { useDb } from '../../db/client'
import { requireFinanceAccess } from '../../services/finance/access'
import { seedCategories } from '../../services/finance/categories'
import { financeOverview } from '../../services/finance/overview'
import { financeCurrency } from '../../services/finance/settings'
import { requireHousehold } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const query = await getValidatedQuery(event, financeForecastQuerySchema.partial().parse)
  const { currency, currencyExponent, forecastDays } = financeCurrency(household)

  // Idempotent: gives a brand-new household a usable category list without a
  // separate "set up finance" step.
  seedCategories(useDb(), household.id)

  return financeOverview(useDb(), household.id, {
    currency,
    currencyExponent,
    forecastDays: query.days ?? forecastDays,
  })
})
