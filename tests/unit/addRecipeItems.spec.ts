import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { createDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings,
  households,
  recipeIngredients,
  recipes,
  shoppingListItems,
  shoppingLists,
} from '../../server/db/schema'
import { addRecipeItems } from '../../server/services/shopping/addRecipeItems'

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
  const inserted = ingredients.map((ing, i) => db.insert(recipeIngredients).values({
    recipeId: recipe.id,
    sortOrder: i,
    raw: ing.raw,
    quantity: ing.quantity ?? null,
    unit: ing.unit ?? null,
    name: ing.name ?? null,
  }).returning().get())
  return { recipe, ingredients: inserted }
}

function itemsOf(listId: string) {
  return db.select().from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId)).all()
}

describe('addRecipeItems', () => {
  it('adds only the selected subset and creates the default list', () => {
    const { recipe, ingredients } = addRecipe('Tacos', [
      { raw: '1 lb ground beef', quantity: 1, unit: 'lb', name: 'ground beef' },
      { raw: '8 tortillas', quantity: 8, unit: null, name: 'tortillas' },
      { raw: 'salt to taste' }, // unparsed — not selected
    ])

    const result = addRecipeItems(db, {
      householdId,
      recipeId: recipe.id,
      ingredientIds: [ingredients[0]!.id, ingredients[1]!.id],
    })
    expect(result.created).toBe(2)
    expect(result.merged).toBe(0)

    const list = db.select().from(shoppingLists)
      .where(eq(shoppingLists.householdId, householdId)).get()!
    expect(list.name).toBe('Groceries')
    expect(list.isDefault).toBe(true)
    expect(result.listId).toBe(list.id)

    const items = itemsOf(list.id)
    expect(items).toHaveLength(2)
    const beef = items.find(i => i.name === 'ground beef')!
    expect(beef.quantity).toBeCloseTo(453.6, 1)
    expect(beef.unit).toBe('g')
    expect(beef.displayQuantity).toBe('1 lb')
    expect(beef.category).toBe('Meat & Seafood')
    expect(beef.sourceRecipeIds).toEqual([recipe.id])
    const tortillas = items.find(i => i.name === 'tortillas')!
    expect(tortillas.quantity).toBe(8)
    expect(tortillas.unit).toBeNull()
    expect(tortillas.displayQuantity).toBe('8')
  })

  it('applies the scale to parsed quantities', () => {
    const { recipe, ingredients } = addRecipe('Chili', [
      { raw: '1 lb ground beef', quantity: 1, unit: 'lb', name: 'ground beef' },
      { raw: '2 cans black beans', quantity: 2, unit: 'cans', name: 'black beans' },
    ], 4)

    const result = addRecipeItems(db, {
      householdId,
      recipeId: recipe.id,
      ingredientIds: ingredients.map(i => i.id),
      scale: 2, // servingsOverride 8 / servings 4
    })
    expect(result.created).toBe(2)

    const items = itemsOf(result.listId)
    const beef = items.find(i => i.name === 'ground beef')!
    expect(beef.quantity).toBeCloseTo(907.2, 1)
    expect(beef.displayQuantity).toBe('2 lb')
    const beans = items.find(i => i.name === 'black beans')! // opaque unit kept as-is
    expect(beans.quantity).toBe(4)
    expect(beans.unit).toBe('cans')
    expect(beans.displayQuantity).toBe('4 cans')
  })

  it('merges into an existing unchecked item of the same key + family', () => {
    const list = db.insert(shoppingLists).values({
      householdId, name: 'Groceries', isDefault: true,
    }).returning().get()
    const other = 'recipe-from-before'
    db.insert(shoppingListItems).values({
      listId: list.id, name: 'Milk', quantity: 236.6, unit: 'ml',
      displayQuantity: '1 cup', sourceRecipeIds: [other],
    }).run()

    const { recipe, ingredients } = addRecipe('Pancakes', [
      { raw: '1 cup milk', quantity: 1, unit: 'cup', name: 'milk' },
    ])
    const result = addRecipeItems(db, {
      householdId,
      recipeId: recipe.id,
      ingredientIds: [ingredients[0]!.id],
    })
    expect(result.merged).toBe(1)
    expect(result.created).toBe(0)
    expect(result.listId).toBe(list.id)

    const items = itemsOf(list.id)
    expect(items).toHaveLength(1)
    expect(items[0]!.quantity).toBeCloseTo(473.2, 1)
    expect(items[0]!.unit).toBe('ml')
    expect(items[0]!.displayQuantity).toBe('2 cups')
    expect(items[0]!.sourceRecipeIds).toEqual(expect.arrayContaining([other, recipe.id]))
  })

  it('sums count-style quantities when merging', () => {
    const list = db.insert(shoppingLists).values({
      householdId, name: 'Groceries', isDefault: true,
    }).returning().get()
    db.insert(shoppingListItems).values({
      listId: list.id, name: 'Eggs', quantity: 6, unit: null, displayQuantity: '6',
    }).run()

    const { recipe, ingredients } = addRecipe('Breakfast', [
      { raw: '3 eggs, beaten', quantity: 3, unit: null, name: 'Eggs, beaten' },
    ])
    const result = addRecipeItems(db, {
      householdId, recipeId: recipe.id, ingredientIds: [ingredients[0]!.id],
    })
    expect(result.merged).toBe(1)

    const [item] = itemsOf(list.id)
    expect(item!.quantity).toBe(9)
    expect(item!.displayQuantity).toBe('9')
  })

  it('never merges into a checked item', () => {
    const list = db.insert(shoppingLists).values({
      householdId, name: 'Groceries', isDefault: true,
    }).returning().get()
    db.insert(shoppingListItems).values({
      listId: list.id, name: 'Milk', quantity: 236.6, unit: 'ml',
      displayQuantity: '1 cup', checked: true, checkedAt: new Date(),
    }).run()

    const { recipe, ingredients } = addRecipe('Pancakes', [
      { raw: '1 cup milk', quantity: 1, unit: 'cup', name: 'milk' },
    ])
    const result = addRecipeItems(db, {
      householdId, recipeId: recipe.id, ingredientIds: [ingredients[0]!.id],
    })
    expect(result.created).toBe(1)
    expect(result.merged).toBe(0)
    expect(itemsOf(list.id)).toHaveLength(2)
  })

  it('inserts an unparsed ingredient with its raw text', () => {
    const { recipe, ingredients } = addRecipe('Soup', [
      { raw: 'a splash of olive oil' },
    ])
    const result = addRecipeItems(db, {
      householdId, recipeId: recipe.id, ingredientIds: [ingredients[0]!.id],
    })
    expect(result.created).toBe(1)

    const [item] = itemsOf(result.listId)
    expect(item!.name).toBe('a splash of olive oil')
    expect(item!.quantity).toBeNull()
    expect(item!.unit).toBeNull()
    expect(item!.displayQuantity).toBeNull()
    expect(item!.category).toBe('Pantry') // "olive oil" keyword still matches
  })

  it('targets an explicit listId and 404s on an unknown one', () => {
    const costco = db.insert(shoppingLists).values({
      householdId, name: 'Costco run', isDefault: false,
    }).returning().get()
    // A default list exists too — the explicit id must win.
    db.insert(shoppingLists).values({
      householdId, name: 'Groceries', isDefault: true,
    }).run()

    const { recipe, ingredients } = addRecipe('Pancakes', [
      { raw: '1 cup milk', quantity: 1, unit: 'cup', name: 'milk' },
    ])
    const result = addRecipeItems(db, {
      householdId, listId: costco.id, recipeId: recipe.id, ingredientIds: [ingredients[0]!.id],
    })
    expect(result.listId).toBe(costco.id)
    expect(itemsOf(costco.id)).toHaveLength(1)

    expect(() => addRecipeItems(db, {
      householdId, listId: 'nope', recipeId: recipe.id, ingredientIds: [ingredients[0]!.id],
    })).toThrowError()
  })

  it('resolves the existing default list when no listId is given', () => {
    const def = db.insert(shoppingLists).values({
      householdId, name: 'Weekly', isDefault: true,
    }).returning().get()

    const { recipe, ingredients } = addRecipe('Salad', [
      { raw: '1 lemon', quantity: 1, unit: null, name: 'lemon' },
    ])
    const result = addRecipeItems(db, {
      householdId, recipeId: recipe.id, ingredientIds: [ingredients[0]!.id],
    })
    expect(result.listId).toBe(def.id)
    expect(itemsOf(def.id)).toHaveLength(1)
  })

  it('404s when the recipe is missing or belongs to another household', () => {
    expect(() => addRecipeItems(db, {
      householdId, recipeId: 'missing', ingredientIds: ['x'],
    })).toThrowError()
  })
})
