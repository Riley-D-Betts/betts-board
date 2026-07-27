/**
 * Belt-and-braces: /tv/* renders with no acting profile, so the finance gate
 * already refuses it — `requireProfile` inside `getFinanceAccess` fails and
 * every finance route 403s. This makes that explicit rather than emergent, so
 * a future change to how TV sessions work can't quietly open a path.
 *
 * Named to sort after middleware/finance.ts; both run after auth.ts.
 */
export default defineEventHandler((event) => {
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/api/finance/')) return

  const referer = getHeader(event, 'referer')
  if (!referer) return

  try {
    if (new URL(referer).pathname.startsWith('/tv')) {
      throw createError({ statusCode: 403, statusMessage: 'Finance is not available on the wall display' })
    }
  }
  catch (error) {
    // An unparseable Referer is not a reason to fail a request; only rethrow
    // the 403 we raised ourselves.
    if ((error as { statusCode?: number })?.statusCode === 403) throw error
  }
})
