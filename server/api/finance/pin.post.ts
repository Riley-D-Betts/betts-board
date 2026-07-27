import { financePinSetSchema } from '#shared/schemas/finance'
import { setOwnFinancePin } from '../../services/finance/access'
import { checkRateLimit } from '../../utils/rateLimit'
import { requireProfile } from '../../utils/session'

// Set or change your OWN finance PIN. Enrolling somebody else is a separate,
// owner-only route — otherwise a kid could grant themselves access.
export default defineEventHandler(async (event) => {
  const { profile } = await requireProfile(event)
  if (!checkRateLimit(`finance-pin-set:${profile.id}`, 5, 1)) {
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts — try again in a minute' })
  }

  const body = await readValidatedBody(event, financePinSetSchema.parse)
  const { role } = await setOwnFinancePin(event, body)
  // The PIN change revoked every session, including this one — the client
  // goes back to the lock screen and unlocks with the new PIN.
  return { ok: true, role }
})
