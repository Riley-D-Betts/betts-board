import { financeMemberPatchSchema } from '#shared/schemas/finance'
import { requireFinanceOwner, setFinanceMemberRole } from '../../../services/finance/access'

export default defineEventHandler(async (event) => {
  const { profile } = await requireFinanceOwner(event)
  const profileId = getRouterParam(event, 'profileId')!
  const { role } = await readValidatedBody(event, financeMemberPatchSchema.parse)
  setFinanceMemberRole(profile.id, profileId, role)
  return { ok: true }
})
