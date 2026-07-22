import { useDb } from '../../db/client'
import { buildHouseholdIcs } from '../../services/ics/export'
import { getHousehold } from '../../utils/session'

// PUBLIC route (the auth middleware only guards /api/** and /uploads/**):
// the secret icsToken in the path IS the authentication. Wrong token → 404,
// indistinguishable from a route that doesn't exist.
export default defineEventHandler((event) => {
  // The router matches the whole `<token>.ics` segment (the param name varies
  // by router: 'token' vs 'token.ics'), so pull the raw segment off the path
  // and require the .ics suffix ourselves.
  const segment = decodeURIComponent(event.path.split('?')[0]!.split('/').pop() ?? '')
  const token = segment.endsWith('.ics') ? segment.slice(0, -4) : null

  const hh = getHousehold()
  if (!hh || !token || token !== hh.icsToken) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  setHeader(event, 'Content-Type', 'text/calendar; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'inline; filename="betts-board.ics"')
  return buildHouseholdIcs(useDb(), hh)
})
