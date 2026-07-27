import { financeCategoryCreateSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { createCategory } from '../../../services/finance/categories'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const body = await readValidatedBody(event, financeCategoryCreateSchema.parse)
  return createCategory(useDb(), household.id, body)
})
