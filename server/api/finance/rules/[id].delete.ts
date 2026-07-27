import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { deleteRule } from '../../../services/finance/rules'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  deleteRule(useDb(), requireHousehold().id, getRouterParam(event, 'id')!)
  return { ok: true }
})
