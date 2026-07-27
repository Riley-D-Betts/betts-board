import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { listConnections } from '../../../services/finance/connections'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  return listConnections(useDb(), requireHousehold().id)
})
