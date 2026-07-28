import { useDb } from '../../db/client'
import { archiveProfile } from '../../services/profiles/store'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  archiveProfile(useDb(), id)
  return { ok: true }
})
