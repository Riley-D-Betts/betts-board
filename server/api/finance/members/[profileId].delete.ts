import { removeFinanceMember, requireFinanceOwner } from '../../../services/finance/access'

export default defineEventHandler(async (event) => {
  const { profile } = await requireFinanceOwner(event)
  const profileId = getRouterParam(event, 'profileId')!
  removeFinanceMember(profile.id, profileId)
  return { ok: true }
})
