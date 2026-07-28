import { verify } from '@node-rs/argon2'
import type { H3Event } from 'h3'
import { setResponseHeader } from 'h3'
import { checkIpRateLimit } from '../../utils/rateLimit'
import { requireHousehold, setBoardSession } from '../../utils/session'
import { clearUnlockFailures, recordUnlockFailure, unlockLockoutRemainingMs } from './unlockLockout'

/**
 * The lock screen is the only unauthenticated password check in the app
 * (/api/auth/unlock is on the middleware's PUBLIC_API list), so it carries two
 * independent brakes:
 *
 *  1. a per-caller token bucket, keyed on the socket address — see
 *     server/utils/clientIp.ts for why the key is not taken from a header;
 *  2. a household-wide consecutive-failure lockout, because (1) is per key and
 *     a distributed attacker simply brings more keys.
 *
 * Order matters: the household lockout is checked first so that a locked-out
 * household costs an attacker nothing to discover and, more importantly, so
 * that no password is verified while locked.
 */
export async function unlockHousehold(event: H3Event, password: string): Promise<{ ok: true }> {
  const remainingMs = unlockLockoutRemainingMs()
  if (remainingMs > 0) {
    const minutes = Math.ceil(remainingMs / 60_000)
    setResponseHeader(event, 'retry-after', Math.ceil(remainingMs / 1000))
    throw createError({ statusCode: 429, statusMessage: `Too many attempts — locked for ${minutes} more minute(s)` })
  }

  if (!checkIpRateLimit(event, 'unlock', 5, 1)) {
    // Matches the bucket's refill rate below (1 token per minute), so a client
    // that waits exactly this long gets exactly one more attempt. The lockout
    // path above sets the same header from its own, longer, remaining time.
    setResponseHeader(event, 'retry-after', 60)
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts — try again in a minute' })
  }

  const household = requireHousehold()

  // An unparseable hash (e.g. cleared by a BETTS_RESET_PASSWORD boot) is a
  // failed attempt, not a 500 — a throw here would skip the counter below.
  const correct = await verify(household.passwordHash, password).catch(() => false)

  if (!correct) {
    recordUnlockFailure()
    throw createError({ statusCode: 401, statusMessage: 'Wrong password' })
  }

  clearUnlockFailures()
  await setBoardSession(event, { unlocked: true, householdId: household.id })
  return { ok: true }
}
