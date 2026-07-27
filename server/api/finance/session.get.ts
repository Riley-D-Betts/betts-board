import { financeSessionState } from '../../services/finance/access'
import { requireUnlocked } from '../../utils/session'

// Lock state for the acting profile. Deliberately open to any unlocked session
// (see the allowlist in server/middleware/finance.ts) because the lock screen
// has to render before anyone is unlocked. It returns no financial data —
// only whether finance exists, who owns it, and whether this profile is in.
export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  return financeSessionState(event)
})
