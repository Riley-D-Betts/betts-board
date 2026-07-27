import { financeUnlockSchema } from '#shared/schemas/finance'
import { unlockFinance } from '../../services/finance/access'
import { checkRateLimit } from '../../utils/rateLimit'
import { requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
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
