import { financeRuleApplySchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceAccess } from '../../../services/finance/access'
import { runRules } from '../../../services/finance/rules'
import { requireHousehold } from '../../../utils/session'

// Re-runs every rule over existing transactions. Never overwrites a category
// a person set by hand, whatever onlyUncategorized says.
export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const body = await readValidatedBody(event, financeRuleApplySchema.parse)
  return runRules(useDb(), requireHousehold().id, body)
})
