import { eq } from 'drizzle-orm'
import { useDb } from '../db/client'
import { households } from '../db/schema'
import { claimOneShotReset } from '../utils/oneShotReset'

// BETTS_RESET_PASSWORD=1 clears the household password hash; the unlock screen
// then offers "choose a new password". Only someone with access to the
// server's env can trigger this.
//
// It acts ONCE per arming, not once per boot: the variable lives in
// docker-compose.yml and is easy to leave there, and a reset that repeated on
// every restart would silently reopen the board — internet-exposed, for some
// households — to whoever reached it first after any reboot or image update.
// See server/utils/oneShotReset.ts for how the arming is consumed.
export default defineNitroPlugin(() => {
  const hh = useDb().select().from(households).limit(1).get()
  // Before first-run setup there is no password to clear, so don't burn the
  // arming on a boot that could not have done anything.
  if (!hh) return
  if (!claimOneShotReset('BETTS_RESET_PASSWORD')) return

  useDb().update(households).set({ passwordHash: '' }).where(eq(households.id, hh.id)).run()
  console.warn(
    '[betts-board] household password CLEARED (BETTS_RESET_PASSWORD) — set a new one at the unlock screen. '
    + 'Anyone who can reach the board can set it until you do. Remove the variable from your environment now; '
    + 'it will not act again on the next boot.',
  )
})
