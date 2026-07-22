import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { and, eq } from 'drizzle-orm'
import { createDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings,
  households,
  mealPlanEntries,
  pantryItems,
  recipeIngredients,
  recipes,
  shoppingListItems,
  shoppingLists,
} from '../../server/db/schema'
import { generateFromMealPlan } from '../../server/services/shopping/aggregate'
import { categorize } from '../../server/services/shopping/aisles'
import {
  formatQuantity,
  normalizeNameKey,
  parseItemInput,
  toCanonical,
} from '../../server/services/shopping/units'

let db: Db
let householdId: string

beforeEach(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  householdId = db.insert(households).values({
    name: 'Test',
    passwordHash: 'x',
    timezone: 'America/Boise',
    icsToken: 'tok',
    settings: defaultHouseholdSettings,
  }).returning().get().id
})

interface Ing { raw: string, quantity?: number | null, unit?: string | null, name?: string | null }

function addRecipe(title: string, ingredients: Ing[], servings: number | null = null) {
  const recipe = db.insert(recipes).values({
    householdId, title, servings, steps: [],
  }).returning().get()
  for (const [i, ing] of ingredients.entries()) {
    db.insert(recipeIngredients).values({
      recipeId: recipe.id,
      sortOrder: i,
      raw: ing.raw,
      quantity: ing.quantity ?? null,
      unit: ing.unit ?? null,
      name: ing.name ?? null,
    }).run()
  }
  return recipe
}

function planMeal(date: string, recipeId: string, servingsOverride: number | null = null) {
  return db.insert(mealPlanEntries).values({
    householdId, date, slot: 'dinner', recipeId, servingsOverride,
  }).returning().get()
}

function itemsOf(listId: string) {
  return db.select().from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId)).all()
}

const WEEK = { start: '2026-07-20', end: '2026-07-27' }

describe('generateFromMealPlan', () => {
  it('merges tsp + tbsp + cup into kitchen fractions and creates a default list', () => {
    const a = addRecipe('Pancakes', [
      { raw: '1 cup milk', quantity: 1, unit: 'cup', name: 'milk' },
    ])
    const b = addRecipe('Sauce', [
      { raw: '3 tbsp milk', quantity: 3, unit: 'tbsp', name: 'milk' },
      { raw: '3 tsp milk', quantity: 3, unit: 'tsp', name: 'milk' },
    ])
    planMeal('2026-07-20', a.id)
    planMeal('2026-07-21', b.id)

    const result = generateFromMealPlan(db, { householdId, ...WEEK })
    expect(result.created).toBe(1)
    expect(result.merged).toBe(0)

    const list = db.select().from(shoppingLists)
      .where(eq(shoppingLists.householdId, householdId)).get()!
    expect(list.name).toBe('Groceries')
    expect(list.isDefault).toBe(true)
    expect(result.listId).toBe(list.id)

    // 1 cup + 3 tbsp + 3 tsp = 236.6 + 44.37 + 14.79 = 295.76 ml ≈ 1¼ cups
    const [item] = itemsOf(list.id)
    expect(item!.name).toBe('milk')
    expect(item!.displayQuantity).toBe('1¼ cups')
    expect(item!.unit).toBe('ml')
    expect(item!.quantity).toBeCloseTo(295.76, 1)
    expect(item!.category).toBe('Dairy')
    expect(item!.sourceRecipeIds).toEqual(expect.arrayContaining([a.id, b.id]))
  })

  it('16 tbsp aggregates to exactly 1 cup', () => {
    const r = addRecipe('Butter bath', [
      { raw: '16 tbsp butter', quantity: 16, unit: 'tbsp', name: 'butter' },
    ])
    planMeal('2026-07-20', r.id)
    const result = generateFromMealPlan(db, { householdId, ...WEEK })
    const [item] = itemsOf(result.listId)
    expect(item!.displayQuantity).toBe('1 cup')
  })

  it('incompatible families produce a compound display with null quantity', () => {
    const r = addRecipe('Bread', [
      { raw: '2 cups flour', quantity: 2, unit: 'cup', name: 'flour' },
      { raw: '1 lb flour', quantity: 1, unit: 'lb', name: 'flour' },
    ])
    planMeal('2026-07-20', r.id)
    const result = generateFromMealPlan(db, { householdId, ...WEEK })
    const [item] = itemsOf(result.listId)
    expect(item!.displayQuantity).toBe('2 cups + 1 lb')
    expect(item!.quantity).toBeNull()
    expect(item!.unit).toBeNull()
  })

  it('scales quantities by servingsOverride / recipe servings', () => {
    const r = addRecipe('Chili', [
      { raw: '1 lb ground beef', quantity: 1, unit: 'lb', name: 'ground beef' },
    ], 4)
    planMeal('2026-07-20', r.id, 8) // doubled
    const result = generateFromMealPlan(db, { householdId, ...WEEK })
    const [item] = itemsOf(result.listId)
    expect(item!.displayQuantity).toBe('2 lb')
    expect(item!.quantity).toBeCloseTo(907.2, 1)
  })

  it('merges into an existing UNCHECKED item of the same family', () => {
    const list = db.insert(shoppingLists).values({
      householdId, name: 'Groceries', isDefault: true,
    }).returning().get()
    db.insert(shoppingListItems).values({
      listId: list.id, name: 'Milk', quantity: 236.6, unit: 'ml', displayQuantity: '1 cup',
    }).run()

    const r = addRecipe('Pancakes', [
      { raw: '1 cup milk', quantity: 1, unit: 'cup', name: 'milk' },
    ])
    planMeal('2026-07-20', r.id)

    const result = generateFromMealPlan(db, { householdId, ...WEEK })
    expect(result.merged).toBe(1)
    expect(result.created).toBe(0)

    const items = itemsOf(list.id)
    expect(items).toHaveLength(1)
    expect(items[0]!.quantity).toBeCloseTo(473.2, 1)
    expect(items[0]!.displayQuantity).toBe('2 cups')
  })

  it('does NOT merge into a checked item', () => {
    const list = db.insert(shoppingLists).values({
      householdId, name: 'Groceries', isDefault: true,
    }).returning().get()
    db.insert(shoppingListItems).values({
      listId: list.id, name: 'Milk', quantity: 236.6, unit: 'ml',
      displayQuantity: '1 cup', checked: true, checkedAt: new Date(),
    }).run()

    const r = addRecipe('Pancakes', [
      { raw: '1 cup milk', quantity: 1, unit: 'cup', name: 'milk' },
    ])
    planMeal('2026-07-20', r.id)

    const result = generateFromMealPlan(db, { householdId, ...WEEK })
    expect(result.created).toBe(1)
    expect(result.merged).toBe(0)
    expect(itemsOf(list.id)).toHaveLength(2)
  })

  it('flags pantry matches in inPantry but still inserts them', () => {
    db.insert(pantryItems).values({
      householdId, name: 'Olive Oil', nameKey: 'olive oil', category: 'Pantry',
    }).run()
    const r = addRecipe('Dressing', [
      { raw: '2 tbsp olive oil', quantity: 2, unit: 'tbsp', name: 'olive oil' },
      { raw: '1 lemon', quantity: 1, unit: null, name: 'lemon' },
    ])
    planMeal('2026-07-20', r.id)

    const result = generateFromMealPlan(db, { householdId, ...WEEK })
    expect(result.created).toBe(2)
    expect(result.inPantry).toHaveLength(1)
    expect(result.inPantry[0]!.name).toBe('olive oil')

    // Still on the list — the UI offers one-tap removal instead.
    const item = db.select().from(shoppingListItems).where(and(
      eq(shoppingListItems.id, result.inPantry[0]!.itemId),
    )).get()
    expect(item).toBeDefined()
    expect(item!.name).toBe('olive oil')
  })

  it('ignorePantry skips the pantry cross-check', () => {
    db.insert(pantryItems).values({
      householdId, name: 'Olive Oil', nameKey: 'olive oil', category: 'Pantry',
    }).run()
    const r = addRecipe('Dressing', [
      { raw: '2 tbsp olive oil', quantity: 2, unit: 'tbsp', name: 'olive oil' },
    ])
    planMeal('2026-07-20', r.id)

    const result = generateFromMealPlan(db, { householdId, ...WEEK, ignorePantry: true })
    expect(result.inPantry).toHaveLength(0)
    expect(result.created).toBe(1)
  })

  it('reports free-text meals as skipped', () => {
    db.insert(mealPlanEntries).values({
      householdId, date: '2026-07-22', slot: 'dinner', freeText: 'Pizza night out',
    }).run()
    const r = addRecipe('Tacos', [
      { raw: '8 tortillas', quantity: 8, unit: null, name: 'tortillas' },
    ])
    planMeal('2026-07-20', r.id)

    const result = generateFromMealPlan(db, { householdId, ...WEEK })
    expect(result.skippedFreeText).toEqual(['Pizza night out'])
    expect(result.created).toBe(1)
  })

  it('sums count-style (no unit) quantities plainly and merges name variants', () => {
    const a = addRecipe('Salad', [
      { raw: '2 eggs', quantity: 2, unit: null, name: 'eggs' },
    ])
    const b = addRecipe('Breakfast', [
      { raw: '3 Eggs, beaten', quantity: 3, unit: null, name: 'Eggs, beaten' },
    ])
    planMeal('2026-07-20', a.id)
    planMeal('2026-07-21', b.id)

    const result = generateFromMealPlan(db, { householdId, ...WEEK })
    expect(result.created).toBe(1)
    const [item] = itemsOf(result.listId)
    expect(item!.quantity).toBe(5)
    expect(item!.unit).toBeNull()
    expect(item!.displayQuantity).toBe('5')
  })

  it('entries outside [start, end) are not shopped', () => {
    const r = addRecipe('Soup', [
      { raw: '1 onion', quantity: 1, unit: null, name: 'onion' },
    ])
    planMeal('2026-07-27', r.id) // end is exclusive
    const result = generateFromMealPlan(db, { householdId, ...WEEK })
    expect(result.created).toBe(0)
  })
})

describe('units', () => {
  it('toCanonical converts known units and rejects opaque ones', () => {
    expect(toCanonical(2, 'cup')).toEqual({ family: 'volume', amount: 473.2 })
    expect(toCanonical(1, 'tbsp')).toEqual({ family: 'volume', amount: 14.79 })
    expect(toCanonical(2, 'lbs')!.amount).toBeCloseTo(907.2)
    expect(toCanonical(1, 'kg')).toEqual({ family: 'mass', amount: 1000 })
    expect(toCanonical(3, 'cloves')).toBeNull()
    expect(toCanonical(1, 'pinch')).toBeNull()
    expect(toCanonical(1, null)).toBeNull()
  })

  it('formatQuantity renders the largest natural unit with kitchen fractions', () => {
    expect(formatQuantity(236.6, 'volume')).toBe('1 cup')
    expect(formatQuantity(236.6 * 2.25, 'volume')).toBe('2¼ cups')
    expect(formatQuantity(118.3, 'volume')).toBe('½ cup')
    expect(formatQuantity(236.6 / 3, 'volume')).toBe('⅓ cup')
    expect(formatQuantity(44.37, 'volume')).toBe('3 tbsp')
    expect(formatQuantity(9.86, 'volume')).toBe('2 tsp') // below 1 tbsp → tsp
    expect(formatQuantity(2.465, 'volume')).toBe('½ tsp')
    expect(formatQuantity(680.4, 'mass')).toBe('1½ lb')
    expect(formatQuantity(453.6, 'mass')).toBe('1 lb')
    expect(formatQuantity(85.05, 'mass')).toBe('3 oz')
    expect(formatQuantity(15, 'mass')).toBe('15 g')
  })

  it('normalizeNameKey lowercases, strips parentheticals and comma tails', () => {
    expect(normalizeNameKey('Chicken Breast, boneless skinless')).toBe('chicken breast')
    expect(normalizeNameKey('Flour (all-purpose)')).toBe('flour')
    expect(normalizeNameKey('  Milk  ')).toBe('milk')
    expect(normalizeNameKey('extra   virgin  olive oil')).toBe('extra virgin olive oil')
    expect(normalizeNameKey('Tomatoes (Roma), diced')).toBe('tomatoes')
  })

  it('parseItemInput splits a quantity prefix off free-typed items', () => {
    expect(parseItemInput('2 lbs chicken')).toEqual({
      name: 'chicken', quantity: 2, unit: 'lb', displayQuantity: '2 lbs',
    })
    expect(parseItemInput('1.5 l sparkling water')).toEqual({
      name: 'sparkling water', quantity: 1.5, unit: 'l', displayQuantity: '1.5 l',
    })
    expect(parseItemInput('3 avocados')).toEqual({
      name: 'avocados', quantity: 3, unit: null, displayQuantity: '3',
    })
    expect(parseItemInput('2 cans black beans')).toEqual({
      name: 'black beans', quantity: 2, unit: 'can', displayQuantity: '2 cans',
    })
    expect(parseItemInput('bananas')).toEqual({
      name: 'bananas', quantity: null, unit: null, displayQuantity: null,
    })
  })
})

describe('categorize', () => {
  it('maps keywords to aisles with longest-keyword-wins', () => {
    expect(categorize('chicken breast')).toBe('Meat & Seafood')
    expect(categorize('bell pepper')).toBe('Produce')
    expect(categorize('black pepper')).toBe('Pantry') // beats "pepper" → Produce
    expect(categorize('peanut butter')).toBe('Pantry') // beats "butter" → Dairy
    expect(categorize('ice cream')).toBe('Frozen') // beats "cream" → Dairy
    expect(categorize('whole milk')).toBe('Dairy')
    expect(categorize('coconut milk')).toBe('Pantry')
    expect(categorize('apples')).toBe('Produce') // simple plural
    expect(categorize('cherries')).toBe('Produce') // y → ies plural
    expect(categorize('paper towels')).toBe('Household')
    expect(categorize('orange juice')).toBe('Beverages')
    expect(categorize('rice')).toBe('Pantry') // no false "ice" match
    expect(categorize('mystery goo')).toBe('Other')
  })
})
