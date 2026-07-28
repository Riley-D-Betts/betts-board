import { useDb } from '../../db/client'
import { rotateIcsToken } from '../../services/household/icsToken'
import { requireAdmin, requireHousehold } from '../../utils/session'

// Revocation for the one credential the board hands out that nothing else can
// take back: /feeds/<token>.ics is authenticated by the token alone.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const hh = requireHousehold()
  return { icsToken: rotateIcsToken(useDb(), hh.id) }
})
