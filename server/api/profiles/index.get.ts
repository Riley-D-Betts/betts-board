import { asc, isNull } from 'drizzle-orm'
import { useDb } from '../../db/client'
import { profiles } from '../../db/schema'
import { requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  return useDb()
    .select()
    .from(profiles)
    .where(isNull(profiles.archivedAt))
    .orderBy(asc(profiles.sortOrder), asc(profiles.createdAt))
    .all()
    .map(({ pinHash: _pin, ...rest }) => rest)
})
