import { useDb } from '../db/client'
import { buildBootstrap } from '../services/bootstrap/state'
import { getBoardSession, getHousehold } from '../utils/session'

// PUBLIC (see the allowlist in server/middleware/auth.ts): the client needs to
// know what stage the app is in before it can render the lock screen. What a
// stranger may see versus what a member may see is decided in one place —
// server/services/bootstrap/state.ts.
export default defineEventHandler(async (event) => {
  const household = getHousehold()
  const session = await getBoardSession(event)
  return buildBootstrap(useDb(), household, session)
})
