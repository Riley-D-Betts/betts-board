import { and, eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { pantryItems } from '../../db/schema'
import { categorize } from '../shopping/aisles'
import { normalizeNameKey } from '../shopping/units'

export interface PantryUpsertInput {
  name: string
  quantity?: number | null
  unit?: string | null
  category?: string | null
  barcode?: string | null
}

/** Insert-or-update a pantry item keyed by (householdId, nameKey). */
export function upsertPantryItem(db: Db, householdId: string, input: PantryUpsertInput) {
  const nameKey = normalizeNameKey(input.name)
  const existing = db.select().from(pantryItems).where(and(
    eq(pantryItems.householdId, householdId),
    eq(pantryItems.nameKey, nameKey),
  )).get()

  if (existing) {
    return db.update(pantryItems).set({
      name: input.name,
      quantity: input.quantity !== undefined ? input.quantity : existing.quantity,
      unit: input.unit !== undefined ? input.unit : existing.unit,
      category: input.category ?? existing.category,
      barcode: input.barcode ?? existing.barcode,
    }).where(eq(pantryItems.id, existing.id)).returning().get()
  }

  return db.insert(pantryItems).values({
    householdId,
    name: input.name,
    nameKey,
    quantity: input.quantity ?? null,
    unit: input.unit ?? null,
    category: input.category ?? categorize(nameKey),
    barcode: input.barcode ?? null,
  }).returning().get()
}
