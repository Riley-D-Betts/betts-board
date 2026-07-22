import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm'
import { createError } from 'h3'
import type { GenerateResult } from '#shared/schemas/shopping'
import type { Db } from '../../db/client'
import {
  mealPlanEntries,
  pantryItems,
  recipeIngredients,
  recipes,
  shoppingListItems,
  shoppingLists,
} from '../../db/schema'
import { categorize } from './aisles'
import { formatCount, formatQuantity, normalizeNameKey, toCanonical, type UnitFamily } from './units'

export interface GenerateArgs {
  householdId: string
  start: string // inclusive YYYY-MM-DD
  end: string // exclusive YYYY-MM-DD
  listId?: string
  ignorePantry?: boolean
  createdByProfileId?: string
}

interface Group {
  nameKey: string
  displayName: string
  families: Map<UnitFamily, number> // canonical sums (ml / g)
  count: number // sum of unit-less quantities
  opaque: Map<string, number> // unknown unit → summed quantity
  hasBare: boolean // at least one "some of it" part with no numbers
  recipeIds: Set<string>
}

/** "Chicken Breast, boneless (about 2)" → "Chicken Breast" (case preserved). */
function displayNameOf(name: string): string {
  let s = name.replace(/\([^)]*\)/g, ' ')
  const comma = s.indexOf(',')
  if (comma !== -1) s = s.slice(0, comma)
  return s.replace(/\s+/g, ' ').trim()
}

/** listId when given (404 if unknown), else the default list, creating "Groceries" if none. */
export function resolveTargetList(db: Db, householdId: string, listId?: string) {
  if (listId) {
    const list = db.select().from(shoppingLists)
      .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.householdId, householdId)))
      .get()
    if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })
    return list
  }
  const def = db.select().from(shoppingLists)
    .where(and(eq(shoppingLists.householdId, householdId), eq(shoppingLists.isDefault, true)))
    .get()
  if (def) return def
  return db.insert(shoppingLists)
    .values({ householdId, name: 'Groceries', isDefault: true })
    .returning().get()
}

/** Family of an existing item's canonical quantity/unit, or 'count', or null (opaque). */
function itemFamily(item: { quantity: number | null, unit: string | null }): UnitFamily | 'count' | null {
  if (item.quantity == null) return null
  if (item.unit == null) return 'count'
  return toCanonical(item.quantity, item.unit)?.family ?? null
}

/**
 * Aggregate the meal plan's recipe ingredients in [start, end) into shopping
 * list items: convert to canonical units, merge same-name ingredients, merge
 * into existing UNCHECKED items of the same unit family, cross-check the
 * pantry, and report what happened.
 */
export function generateFromMealPlan(db: Db, args: GenerateArgs): GenerateResult & { listId: string } {
  const { householdId, start, end } = args

  const entries = db.select().from(mealPlanEntries).where(and(
    eq(mealPlanEntries.householdId, householdId),
    gte(mealPlanEntries.date, start),
    lt(mealPlanEntries.date, end),
  )).orderBy(asc(mealPlanEntries.date)).all()

  const skippedFreeText = entries
    .filter(e => e.recipeId == null && e.freeText)
    .map(e => e.freeText!)

  const recipeEntries = entries.filter(e => e.recipeId != null)
  const recipeIds = [...new Set(recipeEntries.map(e => e.recipeId!))]

  const recipeById = new Map(
    recipeIds.length
      ? db.select().from(recipes).where(inArray(recipes.id, recipeIds)).all().map(r => [r.id, r] as const)
      : [],
  )
  const ingredientRows = recipeIds.length
    ? db.select().from(recipeIngredients)
        .where(inArray(recipeIngredients.recipeId, recipeIds))
        .orderBy(asc(recipeIngredients.sortOrder)).all()
    : []
  const ingredientsByRecipe = new Map<string, typeof ingredientRows>()
  for (const row of ingredientRows) {
    const list = ingredientsByRecipe.get(row.recipeId) ?? []
    list.push(row)
    ingredientsByRecipe.set(row.recipeId, list)
  }

  // ---- group + sum -------------------------------------------------------
  const groups = new Map<string, Group>()
  for (const entry of recipeEntries) {
    const recipe = recipeById.get(entry.recipeId!)
    if (!recipe) continue
    const scale = entry.servingsOverride && recipe.servings
      ? entry.servingsOverride / recipe.servings
      : 1

    for (const ing of ingredientsByRecipe.get(recipe.id) ?? []) {
      const rawName = ing.name ?? ing.raw
      const nameKey = normalizeNameKey(rawName)
      if (!nameKey) continue

      let group = groups.get(nameKey)
      if (!group) {
        group = {
          nameKey,
          displayName: displayNameOf(rawName),
          families: new Map(),
          count: 0,
          opaque: new Map(),
          hasBare: false,
          recipeIds: new Set(),
        }
        groups.set(nameKey, group)
      }
      group.recipeIds.add(recipe.id)

      const qty = ing.quantity != null ? ing.quantity * scale : null
      if (qty == null) {
        group.hasBare = true
        continue
      }
      const canonical = toCanonical(qty, ing.unit)
      if (canonical) {
        group.families.set(canonical.family, (group.families.get(canonical.family) ?? 0) + canonical.amount)
      }
      else if (ing.unit) {
        group.opaque.set(ing.unit, (group.opaque.get(ing.unit) ?? 0) + qty)
      }
      else {
        group.count += qty
      }
    }
  }

  // ---- write to the target list ------------------------------------------
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

  const pantryKeys = new Set<string>(
    args.ignorePantry
      ? []
      : db.select({ nameKey: pantryItems.nameKey }).from(pantryItems)
          .where(eq(pantryItems.householdId, householdId)).all()
          .map(p => p.nameKey),
  )

  let created = 0
  let merged = 0
  const inPantry: { name: string, itemId: string }[] = []

  for (const group of groups.values()) {
    const parts: string[] = []
    for (const family of ['volume', 'mass'] as const) {
      const sum = group.families.get(family)
      if (sum != null) parts.push(formatQuantity(sum, family))
    }
    if (group.count > 0) parts.push(formatCount(group.count))
    for (const [unit, qty] of group.opaque) parts.push(`${formatCount(qty)} ${unit}`)

    const sourceRecipeIds = [...group.recipeIds]
    const singleFamily = group.families.size === 1 && group.count === 0 && group.opaque.size === 0
      ? [...group.families.keys()][0]!
      : null
    const countOnly = group.families.size === 0 && group.opaque.size === 0 && group.count > 0

    let itemId: string | null = null

    if (singleFamily || countOnly) {
      const candidates = existingByKey.get(group.nameKey) ?? []
      const match = candidates.find(c => itemFamily(c) === (singleFamily ?? 'count'))
      if (match) {
        if (singleFamily) {
          const total = toCanonical(match.quantity!, match.unit)!.amount + group.families.get(singleFamily)!
          db.update(shoppingListItems).set({
            quantity: total,
            unit: singleFamily === 'volume' ? 'ml' : 'g',
            displayQuantity: formatQuantity(total, singleFamily),
            sourceRecipeIds: [...new Set([...(match.sourceRecipeIds ?? []), ...sourceRecipeIds])],
          }).where(eq(shoppingListItems.id, match.id)).run()
          match.quantity = total
          match.unit = singleFamily === 'volume' ? 'ml' : 'g'
        }
        else {
          const total = match.quantity! + group.count
          db.update(shoppingListItems).set({
            quantity: total,
            displayQuantity: formatCount(total),
            sourceRecipeIds: [...new Set([...(match.sourceRecipeIds ?? []), ...sourceRecipeIds])],
          }).where(eq(shoppingListItems.id, match.id)).run()
          match.quantity = total
        }
        merged++
        itemId = match.id
      }
    }

    if (!itemId) {
      const quantity = singleFamily
        ? group.families.get(singleFamily)!
        : countOnly ? group.count : null
      const unit = singleFamily ? (singleFamily === 'volume' ? 'ml' : 'g') : null
      const inserted = db.insert(shoppingListItems).values({
        listId: list.id,
        name: group.displayName,
        displayQuantity: parts.length ? parts.join(' + ') : null,
        quantity,
        unit,
        category: categorize(group.nameKey),
        sourceRecipeIds,
        createdByProfileId: args.createdByProfileId ?? null,
      }).returning().get()
      created++
      itemId = inserted.id
      const bucket = existingByKey.get(group.nameKey) ?? []
      bucket.push(inserted)
      existingByKey.set(group.nameKey, bucket)
    }

    if (pantryKeys.has(group.nameKey)) {
      inPantry.push({ name: group.displayName, itemId })
    }
  }

  return { created, merged, inPantry, skippedFreeText, listId: list.id }
}
