import { eq } from 'drizzle-orm'
import type { BarcodeLookupResult } from '#shared/schemas/pantry'
import type { Db } from '../../db/client'
import { barcodeCache } from '../../db/schema'

interface OffProduct {
  product_name?: string
  brands?: string
  image_front_small_url?: string
}

/**
 * Resolve a barcode: local cache first, then Open Food Facts (10 s timeout).
 * Successful OFF lookups are cached so re-scans work instantly and offline.
 * Misses and network errors both come back as { found: false } — never throws.
 */
export async function lookupBarcode(db: Db, code: string): Promise<BarcodeLookupResult> {
  const cached = db.select().from(barcodeCache).where(eq(barcodeCache.barcode, code)).get()
  if (cached) {
    return {
      barcode: code,
      found: true,
      productName: cached.productName,
      brand: cached.brand,
      imageUrl: cached.imageUrl,
      source: cached.source,
    }
  }

  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,image_front_small_url`,
      {
        headers: { 'User-Agent': 'BettsBoard/1.0 (self-hosted family app)' },
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!res.ok) return { barcode: code, found: false }
    const data = await res.json() as { product?: OffProduct }
    const productName = data.product?.product_name?.trim()
    if (!productName) return { barcode: code, found: false }

    const brand = data.product?.brands?.trim() || null
    const imageUrl = data.product?.image_front_small_url || null
    db.insert(barcodeCache).values({
      barcode: code,
      productName,
      brand,
      imageUrl,
      source: 'off',
      fetchedAt: new Date(),
    }).onConflictDoUpdate({
      target: barcodeCache.barcode,
      set: { productName, brand, imageUrl, source: 'off', fetchedAt: new Date() },
    }).run()

    return { barcode: code, found: true, productName, brand, imageUrl, source: 'off' }
  }
  catch {
    return { barcode: code, found: false }
  }
}

/** Remember a user-supplied name for a barcode ("name it and we'll remember"). */
export function saveManualBarcode(
  db: Db,
  input: { barcode: string, productName: string, brand?: string | null },
): BarcodeLookupResult {
  const brand = input.brand ?? null
  db.insert(barcodeCache).values({
    barcode: input.barcode,
    productName: input.productName,
    brand,
    imageUrl: null,
    source: 'manual',
    fetchedAt: new Date(),
  }).onConflictDoUpdate({
    target: barcodeCache.barcode,
    set: { productName: input.productName, brand, source: 'manual', fetchedAt: new Date() },
  }).run()

  return { barcode: input.barcode, found: true, productName: input.productName, brand, source: 'manual' }
}
