import { financeConnectionPatchSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceOwner } from '../../../services/finance/access'
import { patchConnection } from '../../../services/finance/connections'
import { requireHousehold } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireFinanceOwner(event)
  const body = await readValidatedBody(event, financeConnectionPatchSchema.parse)
  const row = patchConnection(useDb(), requireHousehold().id, getRouterParam(event, 'id')!, body)
  // Never return the encrypted access URL, even to an owner.
  return { id: row.id, nickname: row.nickname, status: row.status, syncIntervalMinutes: row.syncIntervalMinutes }
})
