import { financeUnlockSchema } from '#shared/schemas/finance'
import { unlockFinance } from '../../services/finance/access'
import { checkRateLimit } from '../../utils/rateLimit'
import { requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  // An API key must not reach this route. It could never actually unlock
  // finance — getFinanceAccess refuses bearer sessions outright, and the nonce
  // lives in a cookie a key request doesn't have — but it could still GUESS
  // PINs, and every wrong guess feeds the persistent lockout. That makes a key
  // both a guessing oracle and a way to lock a family member out of their own
  // money without ever touching the tablet.
  if (event.context.boardApiSession) {
    throw createError({ statusCode: 403, statusMessage: 'Finance is not available to API keys' })
  }

  // Two limiters, doing different jobs. The persistent per-profile lockout in
  // unlockFinance() is the real control (it survives restarts, which the
  // in-memory one does not); this one just blunts a burst before argon2 runs.
  const { profile } = await requireProfile(event)
  if (!checkRateLimit(`finance-pin:${profile.id}`, 5, 1)) {
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts — try again in a minute' })
  }

  const body = await readValidatedBody(event, financeUnlockSchema.parse)
  const { expiresAt } = await unlockFinance(event, body)
  return { ok: true, expiresAt }
})
