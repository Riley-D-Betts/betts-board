import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { households } from '../../db/schema'

/**
 * Mints a new ICS token, invalidating the old one.
 *
 * `/feeds/<token>.ics` has no session gate — the token in the path IS the
 * authentication — so a token that leaks (a screenshot of Settings, a shared
 * phone, a subscription URL pasted into a support thread) exposes the family's
 * whole calendar to whoever holds it, forever. Without this the only cure was
 * editing the database by hand. Rotating breaks existing phone subscriptions
 * on purpose: that is what "revoke" means here.
 *
 * Same generator as first-boot setup (24 random bytes, base64url) so a rotated
 * token is no weaker than the original.
 */
export function rotateIcsToken(db: Db, householdId: string): string {
  const icsToken = randomBytes(24).toString('base64url')
  db.update(households).set({ icsToken }).where(eq(households.id, householdId)).run()
  return icsToken
}
