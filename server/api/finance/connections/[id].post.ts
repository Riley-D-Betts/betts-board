import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { getConnection } from '../../../services/finance/connections'
import { syncConnection } from '../../../services/finance/sync'
import { requireHousehold } from '../../../utils/session'

// "Sync now". Any finance member may pull; only an owner may connect.
export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const connection = getConnection(useDb(), requireHousehold().id, getRouterParam(event, 'id')!)
  return syncConnection(useDb(), connection)
})
