import { and, asc, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import type { AddRecipeItemsResult } from '#shared/schemas/shopping'
import type { Db } from '../../db/client'
import { recipeIngredients, recipes, shoppingListItems } from '../../db/schema'
import { resolveTargetList } from './aggregate'
import { categorize } from './aisles'
import { formatCount, formatQuantity, normalizeNameKey, toCanonical, type UnitFamily } from './units'

export interface AddRecipeItemsArgs {
  householdId: string
  listId?: string
  recipeId: string
  ingredientIds: string[]
  scale?: number
  createdByProfileId?: string
}

/** "Chicken Breast, boneless (about 2)" → "Chicken Breast" (case preserved). */
function displayNameOf(name: string): string {
  let s = name.replace(/\([^)]*\)/g, ' ')
  const comma = s.indexOf(',')
  if (comma !== -1) s = s.slice(0, comma)
  return s.replace(/\s+/g, ' ').trim()
}

/** Family of an existing item's canonical quantity/unit, or 'count', or null (opaque). */
function itemFamily(item: { quantity: number | null, unit: string | null }): UnitFamily | 'count' | null {
  if (item.quantity == null) return null
  if (item.unit == null) return 'count'
  return toCanonical(item.quantity, item.unit)?.family ?? null
}

/**
 * Add a hand-picked subset of one recipe's ingredients to a shopping list:
 * scale parsed quantities, canonicalize units, and merge into existing
 * UNCHECKED items of the same name key + unit family — the same merge rules
 * as generateFromMealPlan. Unparsed lines are inserted with their raw text.
 */
export function addRecipeItems(db: Db, args: AddRecipeItemsArgs): AddRecipeItemsResult {
  const { householdId, recipeId, ingredientIds } = args
  const scale = args.scale ?? 1

  const recipe = db.select().from(recipes).where(and(
    eq(recipes.id, recipeId),
    eq(recipes.householdId, householdId),
  )).get()
  if (!recipe) throw createError({ statusCode: 404, statusMessage: 'Recipe not found' })

  const ingredients = ingredientIds.length
    ? db.select().from(recipeIngredients).where(and(
        eq(recipeIngredients.recipeId, recipeId),
        inArray(recipeIngredients.id, ingredientIds),
      )).orderBy(asc(recipeIngredients.sortOrder)).all()
    : []

  const list = resolveTargetList(db, householdId, args.listId)

  const existingUnchecked = db.select().from(shoppingListItems).where(and(
    eq(shoppingListItems.listId, list.id),
    eq(shoppingListItems.checked, false),
  )).all()
  const existingByKey = new Map<string, typeof existingUnchecked>()
  for (const item of existingUnchecked) {
    const key = normalizeNameKey(item.name)
    const bucket = existingByKey.get(key) ?? []
    bucket.push(item)
    existingByKey.set(key, bucket)
  }

  let created = 0
  let merged = 0

  for (const ing of ingredients) {
    const rawName = ing.name ?? ing.raw
    const nameKey = normalizeNameKey(rawName)
    if (!nameKey) continue

    const qty = ing.quantity != null ? ing.quantity * scale : null
    const canonical = qty != null ? toCanonical(qty, ing.unit) : null
    const family: UnitFamily | 'count' | null = canonical
      ? canonical.family
      : qty != null && ing.unit == null ? 'count' : null

    // ---- merge into an existing unchecked item of the same family ---------
    if (family) {
      const candidates = existingByKey.get(nameKey) ?? []
      const match = candidates.find(c => itemFamily(c) === family)
      if (match) {
        if (canonical) {
          const total = toCanonical(match.quantity!, match.unit)!.amount + canonical.amount
          db.update(shoppingListItems).set({
            quantity: total,
            unit: canonical.family === 'volume' ? 'ml' : 'g',
            displayQuantity: formatQuantity(total, canonical.family),
            sourceRecipeIds: [...new Set([...(match.sourceRecipeIds ?? []), recipeId])],
          }).where(eq(shoppingListItems.id, match.id)).run()
          match.quantity = total
          match.unit = canonical.family === 'volume' ? 'ml' : 'g'
        }
        else {
          const total = match.quantity! + qty!
          db.update(shoppingListItems).set({
            quantity: total,
            displayQuantity: formatCount(total),
            sourceRecipeIds: [...new Set([...(match.sourceRecipeIds ?? []), recipeId])],
          }).where(eq(shoppingListItems.id, match.id)).run()
          match.quantity = total
        }
        merged++
        continue
      }
    }

    // ---- insert ------------------------------------------------------------
    const quantity = canonical ? canonical.amount : qty
    const unit = canonical ? (canonical.family === 'volume' ? 'ml' : 'g') : (qty != null ? ing.unit : null)
    const displayQuantity = canonical
      ? formatQuantity(canonical.amount, canonical.family)
      : qty != null
        ? (ing.unit ? `${formatCount(qty)} ${ing.unit}` : formatCount(qty))
        : null
    const name = qty == null && ing.name == null
      ? ing.raw.replace(/\s+/g, ' ').trim() // fully unparsed line — keep the raw text
      : displayNameOf(rawName) || rawName

    const inserted = db.insert(shoppingListItems).values({
      listId: list.id,
      name,
      displayQuantity,
      quantity,
      unit,
      category: categorize(nameKey),
      sourceRecipeIds: [recipeId],
      createdByProfileId: args.createdByProfileId ?? null,
    }).returning().get()
    created++
    const bucket = existingByKey.get(nameKey) ?? []
    bucket.push(inserted)
    existingByKey.set(nameKey, bucket)
  }

  return { created, merged, listId: list.id }
}
