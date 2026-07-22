import { useDb } from '../../db/client'
import { getVapidKeys } from '../../services/push/vapid'
import { requireHousehold, requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  requireHousehold()
  const keys = getVapidKeys(useDb())
  if (!keys) throw createError({ statusCode: 409, statusMessage: 'Setup required' })
  return { publicKey: keys.publicKey }
})
