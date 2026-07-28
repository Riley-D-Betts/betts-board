import { isNotNull } from 'drizzle-orm'
import { useDb } from '../db/client'
import { financeSessions, profiles } from '../db/schema'
import { markFinanceResetArmed } from '../services/finance/access'
import { claimOneShotReset } from '../utils/oneShotReset'

// BETTS_RESET_FINANCE_PIN=1 clears every finance PIN and kills every unlocked
// finance session. Whoever sets a PIN first afterwards becomes the finance
// owner again — the same trust model as BETTS_RESET_PASSWORD, which likewise
// leaves the board claimable. Only someone with access to the server's env can
// trigger it.
//
// Like BETTS_RESET_PASSWORD it acts ONCE per arming (see
// server/utils/oneShotReset.ts). Left in docker-compose.yml it would otherwise
// hand the family's bank data to whoever set a PIN first after each restart,
// and the real owner would find themselves locked out with no signal beyond a
// log line nobody reads.
//
// Deliberately does NOT touch finance data or bank connections: a forgotten
// PIN shouldn't cost the family their history. The stored access URLs stay
// encrypted with the same key, so sync keeps working through the reset.
export default defineNitroPlugin(() => {
  // Nothing to clear means nothing to reset — don't consume the arming on a
  // boot before anyone has enrolled in Money.
  const anyPin = useDb().select({ id: profiles.id }).from(profiles)
    .where(isNotNull(profiles.pinHash)).limit(1).get()
  if (!anyPin) return
  if (!claimOneShotReset('BETTS_RESET_FINANCE_PIN')) return

  const cleared = useDb().update(profiles)
    .set({ pinHash: null })
    .where(isNotNull(profiles.pinHash))
    .returning({ id: profiles.id })
    .all()
  useDb().delete(financeSessions).run()
  markFinanceResetArmed()

  console.warn(
    `[betts-board] ${cleared.length} finance PIN(s) CLEARED (BETTS_RESET_FINANCE_PIN) — `
    + 'set a new one on the Finance page; whoever does it first becomes the owner. '
    + 'Bank connections and history are untouched. Remove the variable from your environment now; '
    + 'it will not act again on the next boot.',
  )
})
