import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { listImportBatches } from '../../../services/finance/import'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  return listImportBatches(useDb(), requireHousehold().id)
})
