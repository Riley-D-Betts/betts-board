import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { listCategories, seedCategories } from '../../../services/finance/categories'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  seedCategories(useDb(), household.id)
  return listCategories(useDb(), household.id)
})
