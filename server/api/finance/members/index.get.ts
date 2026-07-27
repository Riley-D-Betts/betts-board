import { eq } from 'drizzle-orm'
import { useDb } from '../../../db/client'
import { financeMembers, profiles } from '../../../db/schema'
import { requireFinanceAccess } from '../../../services/finance/access'

export default defineEventHandler(async (event) => {
  await requireFinanceAccess(event)
  return useDb()
    .select({
      profileId: financeMembers.profileId,
      name: profiles.name,
      color: profiles.color,
      avatarPath: profiles.avatarPath,
      role: financeMembers.role,
      lastUnlockAt: financeMembers.lastUnlockAt,
      failedSinceLastUnlock: financeMembers.failedSinceLastUnlock,
      lockedUntil: financeMembers.lockedUntil,
    })
    .from(financeMembers)
    .innerJoin(profiles, eq(profiles.id, financeMembers.profileId))
    .all()
    .map(m => ({
      ...m,
      lastUnlockAt: m.lastUnlockAt?.getTime() ?? null,
      lockedUntil: m.lockedUntil?.getTime() ?? null,
    }))
})
