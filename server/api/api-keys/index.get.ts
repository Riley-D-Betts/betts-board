import { useDb } from '../../db/client'
import { listApiKeys } from '../../services/apiKeys/keys'
import { requireAdmin, requireHousehold } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const hh = requireHousehold()
  return listApiKeys(useDb(), hh.id)
})
