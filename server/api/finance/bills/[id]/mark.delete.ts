import { z } from 'zod'
import { useDb } from '../../../../db/client'
import { requireFinanceAccess } from '../../../../services/finance/access'
import { clearBillOccurrence } from '../../../../services/finance/bills'
import { requireHousehold } from '../../../../utils/session'

const querySchema = z.object({ dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

// Back to "due": deletes the override row rather than storing a third state.
export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const { dueDate } = await getValidatedQuery(event, querySchema.parse)
  clearBillOccurrence(useDb(), requireHousehold().id, getRouterParam(event, 'id')!, dueDate)
  return { ok: true }
})
