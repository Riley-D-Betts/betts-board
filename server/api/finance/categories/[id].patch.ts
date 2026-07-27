import { financeCategoryPatchSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { patchCategory } from '../../../services/finance/categories'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const body = await readValidatedBody(event, financeCategoryPatchSchema.parse)
  return patchCategory(useDb(), household.id, getRouterParam(event, 'id')!, body)
})
