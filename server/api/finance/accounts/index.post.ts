import { financeAccountCreateSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { createAccount } from '../../../services/finance/accounts'
import { requireFinanceAccess } from '../../../services/finance/access'
import { financeCurrency } from '../../../services/finance/settings'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const body = await readValidatedBody(event, financeAccountCreateSchema.parse)
  // Default to the household's currency, not USD: a yen household creating an
  // account would otherwise get a USD one, which then groups into its own
  // net-worth bucket and reads as zero everywhere the household currency is
  // used to filter.
  return createAccount(useDb(), household.id, {
    ...body,
    currency: body.currency ?? financeCurrency(household).currency,
  })
})
