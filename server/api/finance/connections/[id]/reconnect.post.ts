import { financeConnectSchema } from '#shared/schemas/finance'
import { useDb } from '../../../../db/client'
import { requireFinanceOwner } from '../../../../services/finance/access'
import { reconnectSimpleFin } from '../../../../services/finance/connections'
import { requireHousehold } from '../../../../utils/session'

// Re-auth after the bank asks for consent again. Replaces the access URL on
// the SAME row, so accounts match by externalId and every category, note,
// budget, and bill survives.
export default defineEventHandler(async (event) => {
  await requireFinanceOwner(event)
  const { setupToken } = await readValidatedBody(event, financeConnectSchema.parse)
  await reconnectSimpleFin(useDb(), {
    householdId: requireHousehold().id,
    connectionId: getRouterParam(event, 'id')!,
    setupToken,
  })
  return { ok: true }
})
