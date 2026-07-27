import { financeRuleCreateSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { createRule } from '../../../services/finance/rules'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const body = await readValidatedBody(event, financeRuleCreateSchema.parse)
  return createRule(useDb(), requireHousehold().id, body)
})
