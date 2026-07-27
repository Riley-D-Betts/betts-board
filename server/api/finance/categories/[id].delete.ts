import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { deleteCategory } from '../../../services/finance/categories'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  return deleteCategory(useDb(), household.id, getRouterParam(event, 'id')!)
})
