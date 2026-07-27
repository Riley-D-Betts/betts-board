import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { deleteBill } from '../../../services/finance/bills'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  deleteBill(useDb(), requireHousehold().id, getRouterParam(event, 'id')!)
  return { ok: true }
})
