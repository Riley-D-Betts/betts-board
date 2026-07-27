import { financeGoalPatchSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { patchGoal } from '../../../services/finance/goals'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const body = await readValidatedBody(event, financeGoalPatchSchema.parse)
  return patchGoal(useDb(), requireHousehold().id, getRouterParam(event, 'id')!, body)
})
