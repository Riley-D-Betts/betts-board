import { financeBillPatchSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { patchBill } from '../../../services/finance/bills'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const body = await readValidatedBody(event, financeBillPatchSchema.parse)
  return patchBill(useDb(), requireHousehold().id, getRouterParam(event, 'id')!, body)
})
