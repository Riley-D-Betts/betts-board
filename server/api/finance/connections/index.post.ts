import { financeConnectSchema } from '#shared/schemas/finance'
import { useDb } from '../../../db/client'
import { requireFinanceOwner } from '../../../services/finance/access'
import { connectSimpleFin } from '../../../services/finance/connections'
import { requireHousehold } from '../../../utils/session'

// Owner-only: this hands the board live read access to a bank account.
export default defineEventHandler(async (event) => {
  const { profile } = await requireFinanceOwner(event)
  const household = requireHousehold()
  const { setupToken, nickname } = await readValidatedBody(event, financeConnectSchema.parse)
  return connectSimpleFin(useDb(), {
    householdId: household.id,
    profileId: profile.id,
    setupToken,
    nickname,
  })
})
