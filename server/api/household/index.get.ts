import { useDb } from '../../db/client'
import { isAdminProfile } from '../../services/profiles/store'
import { toHouseholdDto } from '../../utils/dto'
import { requireHousehold, requireUnlocked } from '../../utils/session'

// Every unlocked session may read the household; only an admin additionally
// gets `icsToken`, which is the sole authentication on the ungated
// /feeds/<token>.ics route. Admins can rotate it via POST /api/household/ics-token.
export default defineEventHandler(async (event) => {
  const session = await requireUnlocked(event)
  const hh = requireHousehold()
  return toHouseholdDto(hh, { isAdmin: isAdminProfile(useDb(), session.profileId) })
})
