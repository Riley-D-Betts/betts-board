import { useDb } from '../../db/client'
import { requireFinanceAccess } from '../../services/finance/access'
import { financeDiagnostics } from '../../services/finance/diagnostics'
import { requireHousehold } from '../../utils/session'

// requireFinanceAccess, not owner-only: this is read-only, it carries no
// credentials, and the person watching a balance disagree with their bank is
// not necessarily the person who connected it.
export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  const household = requireHousehold()
  return financeDiagnostics(useDb(), household.id, household.timezone)
})
