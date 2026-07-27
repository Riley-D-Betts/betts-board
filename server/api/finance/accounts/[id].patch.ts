import { financeAccountPatchSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { patchAccount } from '../../../services/finance/accounts'
import { requireFinanceAccess } from '../../../services/finance/access'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  const body = await readValidatedBody(event, financeAccountPatchSchema.parse)
  return patchAccount(useDb(), household.id, getRouterParam(event, 'id')!, body)
})
