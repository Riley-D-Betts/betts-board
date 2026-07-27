import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { revertImportBatch } from '../../../services/finance/import'
import { requireHousehold } from '../../../utils/session'

// Undo a whole import. A wrong column mapping wrecks a ledger, and without
// this the fix is hand-deleting hundreds of rows.
export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  return revertImportBatch(useDb(), requireHousehold().id, getRouterParam(event, 'id')!)
})
