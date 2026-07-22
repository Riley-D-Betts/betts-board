import { verify } from '@node-rs/argon2'
import { unlockSchema } from '#shared/schemas/auth'
import { checkRateLimit } from '../../utils/rateLimit'
import { requireHousehold, setBoardSession } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  if (!checkRateLimit(`unlock:${ip}`, 5, 1)) {
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts — try again in a minute' })
  }

  const { password } = await readValidatedBody(event, unlockSchema.parse)
  const household = requireHousehold()

  if (!(await verify(household.passwordHash, password))) {
    throw createError({ statusCode: 401, statusMessage: 'Wrong password' })
  }

  await setBoardSession(event, { unlocked: true, householdId: household.id })
  return { ok: true }
})
