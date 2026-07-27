import { eq } from 'drizzle-orm'
import { useDb } from '../../../db/client'
import { financeSessions } from '../../../db/schema'
import { requireFinanceAccess } from '../../../services/finance/access'

// Revoke a finance session — your own (sign out that tablet) or, as an owner,
// anyone's. Deleting the row is the whole revocation: the cookie nonce is
// inert without it, so it takes effect on the very next request.
export default defineEventHandler(async (event) => {
  const access = await requireFinanceAccess(event)
  const id = getRouterParam(event, 'id')!

  const row = useDb().select().from(financeSessions).where(eq(financeSessions.id, id)).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  if (row.profileId !== access.profile.id && access.member.role !== 'owner') {
    throw createError({ statusCode: 403, statusMessage: 'Finance owner only' })
  }

  useDb().delete(financeSessions).where(eq(financeSessions.id, id)).run()
  return { ok: true }
})
