import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { listBills } from '../../../services/finance/bills'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  return listBills(useDb(), requireHousehold().id)
})
