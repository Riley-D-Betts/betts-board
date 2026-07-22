import { describe, expect, it } from 'vitest'
import { parseIngredient } from '../../server/services/recipes/ingredientParser'

describe('parseIngredient', () => {
  it('parses mixed numbers with unit aliases: "1 1/2 cups flour"', () => {
    expect(parseIngredient('1 1/2 cups flour')).toEqual({
      quantity: 1.5, unit: 'cup', name: 'flour', note: null,
    })
  })

  it('parses unicode vulgar fractions: "½ tsp salt"', () => {
    expect(parseIngredient('½ tsp salt')).toEqual({
      quantity: 0.5, unit: 'tsp', name: 'salt', note: null,
    })
  })

  it('takes the max of a range and moves post-comma text to note: "1-2 cloves garlic, minced"', () => {
    expect(parseIngredient('1-2 cloves garlic, minced')).toEqual({
      quantity: 2, unit: 'clove', name: 'garlic', note: 'minced',
    })
  })

  it('treats parentheticals as notes: "2 (14 oz) cans diced tomatoes"', () => {
    expect(parseIngredient('2 (14 oz) cans diced tomatoes')).toEqual({
      quantity: 2, unit: 'can', name: 'diced tomatoes', note: '(14 oz)',
    })
  })

  it('leaves unparseable quantity/unit null: "salt to taste"', () => {
    expect(parseIngredient('salt to taste')).toEqual({
      quantity: null, unit: null, name: 'salt to taste', note: null,
    })
  })

  it('parses a bare count with no unit: "3 eggs"', () => {
    expect(parseIngredient('3 eggs')).toEqual({
      quantity: 3, unit: null, name: 'eggs', note: null,
    })
  })

  it('combines parenthetical and post-comma notes: "butter (softened), divided"', () => {
    expect(parseIngredient('butter (softened), divided')).toEqual({
      quantity: null, unit: null, name: 'butter', note: '(softened), divided',
    })
  })

  it('understands "1 to 2" ranges and word ranges take the max', () => {
    expect(parseIngredient('1 to 2 tbsp olive oil')).toEqual({
      quantity: 2, unit: 'tbsp', name: 'olive oil', note: null,
    })
  })

  it('handles mixed unicode fractions attached to integers: "1½ cups sugar"', () => {
    expect(parseIngredient('1½ cups sugar')).toEqual({
      quantity: 1.5, unit: 'cup', name: 'sugar', note: null,
    })
  })

  it('maps single-letter units case-sensitively (T = tbsp, t = tsp)', () => {
    expect(parseIngredient('1 T vanilla extract')).toMatchObject({ quantity: 1, unit: 'tbsp' })
    expect(parseIngredient('1 t vanilla extract')).toMatchObject({ quantity: 1, unit: 'tsp' })
  })

  it('canonicalizes package aliases and strips "of"', () => {
    expect(parseIngredient('1 package of cream cheese')).toEqual({
      quantity: 1, unit: 'pkg', name: 'cream cheese', note: null,
    })
  })

  it('does not mistake ingredient words for range separators: "1 tomato"', () => {
    expect(parseIngredient('1 tomato')).toEqual({
      quantity: 1, unit: null, name: 'tomato', note: null,
    })
  })

  it('never throws on junk input', () => {
    expect(parseIngredient('')).toEqual({ quantity: null, unit: null, name: null, note: null })
    expect(parseIngredient('   ')).toEqual({ quantity: null, unit: null, name: null, note: null })
    expect(parseIngredient('((((')).toBeTruthy()
    expect(parseIngredient('1/0 cups chaos')).toBeTruthy()
  })
})
