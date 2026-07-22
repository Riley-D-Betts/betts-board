import { useDb } from '../../db/client'
import { revokeApiKey } from '../../services/apiKeys/keys'
import { requireAdmin, requireHousehold } from '../../utils/session'

// Revoke, not hard-delete: the row stays visible (struck through) in Settings.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const hh = requireHousehold()
  if (!revokeApiKey(useDb(), hh.id, id)) {
    throw createError({ statusCode: 404, statusMessage: 'API key not found' })
  }
  return { ok: true }
})
