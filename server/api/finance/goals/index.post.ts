import { financeGoalCreateSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { createGoal } from '../../../services/finance/goals'
import { financeCurrency } from '../../../services/finance/settings'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const body = await readValidatedBody(event, financeGoalCreateSchema.parse)
  return createGoal(useDb(), household.id, { ...body, currency: financeCurrency(household).currency })
})
