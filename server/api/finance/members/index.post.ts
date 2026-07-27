import { financeMemberAddSchema } from '#shared/schemas/finance'
import { addFinanceMember, requireFinanceOwner } from '../../../services/finance/access'

// Owner-only, and it needs a LIVE finance session — being household admin is
// not enough, because becoming admin costs nothing but a tap.
export default defineEventHandler(async (event) => {
  await requireFinanceOwner(event)
  const body = await readValidatedBody(event, financeMemberAddSchema.parse)
  await addFinanceMember(body)
  return { ok: true }
})
