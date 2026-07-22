import { z } from 'zod'

export const pantryItemCreateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  quantity: z.number().nullish(),
  unit: z.string().max(30).nullish(),
  category: z.string().max(50).nullish(),
  barcode: z.string().regex(/^\d{6,14}$/).nullish(),
})

export const pantryItemPatchSchema = pantryItemCreateSchema.partial()

export const pantryQuerySchema = z.object({
  q: z.string().max(200).optional(),
})

/** Manual name for an unknown barcode — remembered in the local cache. */
export const barcodeManualSchema = z.object({
  barcode: z.string().regex(/^\d{6,14}$/),
  productName: z.string().trim().min(1).max(300),
  brand: z.string().trim().max(200).nullish(),
})

export interface BarcodeLookupResult {
  barcode: string
  found: boolean
  productName?: string
  brand?: string | null
  imageUrl?: string | null
  source?: 'off' | 'manual'
}
