import { getFinanceAccess } from '../services/finance/access'

/**
 * Default-deny for /api/finance/**.
 *
 * `requireFinanceAccess` in every route would work right up until someone adds
 * a route and forgets, and that failure is silent. This closes the prefix
 * instead: anything under /api/finance/ that isn't on the short allowlist below
 * needs a live finance session before its handler is ever reached.
 *
 * Runs after middleware/auth.ts (alphabetical order), so the household session
 * and any bearer key are already resolved by the time we get here.
 */
const OPEN_FINANCE_ROUTES = new Set([
  '/api/finance/session', // reports lock state; returns nothing sensitive
  '/api/finance/unlock',
  '/api/finance/lock',
  '/api/finance/pin',
])

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/api/finance/')) return
  if (OPEN_FINANCE_ROUTES.has(path)) return

  const access = await getFinanceAccess(event)
  if (!access) throw createError({ statusCode: 403, statusMessage: 'Finance locked' })

  // Resolved once per request; requireFinanceAccess reads it back so a route
  // outside this prefix would still get a real check rather than a free pass.
  event.context.financeAccess = access
})
