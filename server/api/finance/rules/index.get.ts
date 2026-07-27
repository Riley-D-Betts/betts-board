import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { listRules } from '../../../services/finance/rules'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  return listRules(useDb(), requireHousehold().id)
})
