import { eq } from 'drizzle-orm'
import { useDb } from '../../../db/client'
import { financeSessions, profiles } from '../../../db/schema'
import { pruneExpiredFinanceSessions, requireFinanceAccess } from '../../../services/finance/access'

// "Who currently has the money unlocked, on what device." The single most
// useful security screen for a family: it turns an invisible problem into a
// visible one, and every row has a revoke button.
export default defineEventHandler(async (event) => {
  const access = await requireFinanceAccess(event)
  pruneExpiredFinanceSessions()

  return useDb()
    .select({
      id: financeSessions.id,
      profileId: financeSessions.profileId,
      name: profiles.name,
      deviceLabel: financeSessions.deviceLabel,
      startedAt: financeSessions.startedAt,
      expiresAt: financeSessions.expiresAt,
      lastSeenAt: financeSessions.lastSeenAt,
    })
    .from(financeSessions)
    .innerJoin(profiles, eq(profiles.id, financeSessions.profileId))
    .all()
    .map(s => ({
      ...s,
      isCurrent: s.id === access.session.id,
      startedAt: s.startedAt.getTime(),
      expiresAt: s.expiresAt.getTime(),
      lastSeenAt: s.lastSeenAt.getTime(),
    }))
})
