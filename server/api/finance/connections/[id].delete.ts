import { useDb } from '../../../db/client'
import { requireFinanceOwner } from '../../../services/finance/access'
import { deleteConnection } from '../../../services/finance/connections'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceOwner(event)
  deleteConnection(useDb(), requireHousehold().id, getRouterParam(event, 'id')!)
  return { ok: true }
})
