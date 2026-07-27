import { financePinSetSchema } from '#shared/schemas/finance'
import { setOwnFinancePin } from '../../services/finance/access'
import { checkRateLimit } from '../../utils/rateLimit'
import { requireProfile } from '../../utils/session'

// Set or change your OWN finance PIN. Enrolling somebody else is a separate,
// owner-only route — otherwise a kid could grant themselves access.
export default defineEventHandler(async (event) => {
  // An API key must not reach these routes either. It cannot actually unlock
  // finance — getFinanceAccess refuses bearer sessions outright, and the nonce
  // lives in a cookie a key request does not have — but it could still guess
  // PINs, and every wrong guess feeds the persistent lockout, so a key would
  // be both a guessing oracle and a way to lock a person out of their own
  // money.
  if (event.context.boardApiSession) {
    throw createError({ statusCode: 403, statusMessage: 'Finance is not available to API keys' })
  }

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
