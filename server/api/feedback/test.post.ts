import { useDb } from '../../db/client'
import { testConnection } from '../../services/feedback/github'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return testConnection(useDb())
})
