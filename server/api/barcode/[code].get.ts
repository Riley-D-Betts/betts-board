import { useDb } from '../../db/client'
import { lookupBarcode } from '../../services/pantry/barcode'
import { requireUnlocked } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUnlocked(event)
  const code = getRouterParam(event, 'code')!
  if (!/^\d{6,14}$/.test(code)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid barcode' })
  }
  return lookupBarcode(useDb(), code)
})
