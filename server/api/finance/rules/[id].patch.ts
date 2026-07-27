import { financeRulePatchSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { patchRule } from '../../../services/finance/rules'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const body = await readValidatedBody(event, financeRulePatchSchema.parse)
  return patchRule(useDb(), requireHousehold().id, getRouterParam(event, 'id')!, body)
})
