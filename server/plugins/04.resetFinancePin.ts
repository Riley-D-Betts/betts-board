import { isNotNull } from 'drizzle-orm'
import { useDb } from '../db/client'
import { financeSessions, profiles } from '../db/schema'
import { markFinanceResetArmed } from '../services/finance/access'

// BETTS_RESET_FINANCE_PIN=1 (set for one boot, then removed) clears every
// finance PIN and kills every unlocked finance session. Whoever sets a PIN
// first afterwards becomes the finance owner again — the same trust model as
// BETTS_RESET_PASSWORD, which likewise leaves the board claimable. Only
// someone with access to the server's env can trigger it.
//
// Deliberately does NOT touch finance data or bank connections: a forgotten
// PIN shouldn't cost the family their history. The stored access URLs stay
// encrypted with the same key, so sync keeps working through the reset.
export default defineNitroPlugin(() => {
  if (process.env.BETTS_RESET_FINANCE_PIN !== '1') return

  const cleared = useDb().update(profiles)
    .set({ pinHash: null })
    .where(isNotNull(profiles.pinHash))
    .returning({ id: profiles.id })
    .all()
  useDb().delete(financeSessions).run()
  markFinanceResetArmed()

  console.warn(
    `[betts-board] ${cleared.length} finance PIN(s) cleared (BETTS_RESET_FINANCE_PIN=1) — `
    + 'set a new one on the Finance page. Bank connections and history are untouched.',
  )
})
