import { financeBillMarkSchema } from '#shared/schemas/finance'
import { useDb } from '../../../../db/client'
import { requireFinanceAccess } from '../../../../services/finance/access'
import { markBillOccurrence } from '../../../../services/finance/bills'
import { requireHousehold } from '../../../../utils/session'

// Marks one occurrence paid or skipped — the only time an occurrence becomes
// a row. Passing status back to 'due' is a DELETE of the override.
export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const billId = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, financeBillMarkSchema.parse)
  return markBillOccurrence(useDb(), household.id, billId, body)
})
