import { financeDebtPaymentSchema } from '#shared/schemas/finance'
import { useDb } from '../../../../db/client'
import { requireFinanceAccess } from '../../../../services/finance/access'
import { recordDebtPayment } from '../../../../services/finance/debts'
import { requireHousehold } from '../../../../utils/session'

// A payment is an ordinary positive transaction on the debt's account.
// Refused for bank-synced debts — the payment arrives with the next sync.
export default defineEventHandler(async (event) => {
  const { profile } = await requireFinanceAccess(event)
  const body = await readValidatedBody(event, financeDebtPaymentSchema.parse)
  return recordDebtPayment(useDb(), requireHousehold().id, getRouterParam(event, 'id')!, {
    profileId: profile.id,
    ...body,
  })
})
