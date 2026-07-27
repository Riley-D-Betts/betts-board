import { financeBillQuerySchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { expandBills } from '../../../services/finance/bills'
import { requireHousehold } from '../../../utils/session'

// Expanded occurrences over a half-open window. These are virtual — only the
// ones somebody marked paid or skipped exist as rows.
export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const { start, end } = await getValidatedQuery(event, financeBillQuerySchema.parse)
  return expandBills(useDb(), requireHousehold().id, start, end)
})
