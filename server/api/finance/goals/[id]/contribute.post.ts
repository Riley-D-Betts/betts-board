import { financeGoalContributeSchema } from '#shared/schemas/finance'
import { useDb } from '../../../../db/client'
import { requireFinanceAccess } from '../../../../services/finance/access'
import { contributeToGoal } from '../../../../services/finance/goals'
import { requireHousehold } from '../../../../utils/session'

// Manual contribution ledger. Refused for account-linked goals, whose
// progress IS the account balance — recording both would double-count.
export default defineEventHandler(async (event) => {
  const { profile } = await requireFinanceAccess(event)
  const body = await readValidatedBody(event, financeGoalContributeSchema.parse)
  return contributeToGoal(useDb(), requireHousehold().id, getRouterParam(event, 'id')!, {
    profileId: profile.id,
    ...body,
  })
})
