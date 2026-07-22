import { barcodeManualSchema } from '#shared/schemas/pantry'
import { useDb } from '../../db/client'
import { saveManualBarcode } from '../../services/pantry/barcode'
import { requireProfile } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const input = await readValidatedBody(event, barcodeManualSchema.parse)
  return saveManualBarcode(useDb(), input)
})
