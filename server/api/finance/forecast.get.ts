import { financeForecastQuerySchema } from '#shared/schemas/finance'
import { useDb } from '../../db/client'
import { requireFinanceAccess } from '../../services/finance/access'
import { buildForecast } from '../../services/finance/overview'
import { financeCurrency } from '../../services/finance/settings'
import { requireHousehold } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const { days } = await getValidatedQuery(event, financeForecastQuerySchema.parse)
  const { currency, currencyExponent } = financeCurrency(household)
  return buildForecast(useDb(), household.id, { currency, currencyExponent, days })
})
