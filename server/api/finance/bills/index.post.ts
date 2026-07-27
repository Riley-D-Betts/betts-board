import { financeBillCreateSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { createBill } from '../../../services/finance/bills'
import { financeCurrency } from '../../../services/finance/settings'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const body = await readValidatedBody(event, financeBillCreateSchema.parse)
  return createBill(useDb(), household.id, { ...body, currency: financeCurrency(household).currency })
})
