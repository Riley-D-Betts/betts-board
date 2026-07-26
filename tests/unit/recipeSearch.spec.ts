import { describe, expect, it } from 'vitest'
import { normalizeText, scoreRecipe, tokenize } from '../../server/services/recipes/search'

const chickenSoup = {
  title: 'Chicken Noodle Soup',
  description: 'A cold-weather staple.',
  tags: ['dinner', 'comfort'],
  ingredients: ['chicken thighs', '2 lb chicken thighs', 'egg noodles', '1 bag egg noodles'],
}

const casserole = {
  title: "Grandma's Bake",
  description: 'Family recipe from the blue tin.',
  tags: ['dinner'],
  ingredients: ['chicken breast', '3 chicken breasts, cubed', 'cream of mushroom'],
}

const creme = {
  title: 'Crème Brûlée',
  description: null,
  tags: ['dessert'],
  ingredients: ['heavy cream', '2 cups heavy cream'],
}

function matches(query: string, doc: Parameters<typeof scoreRecipe>[1]) {
  return scoreRecipe(tokenize(query), doc) !== null
}

describe('normalizeText', () => {
  it('strips diacritics and punctuation', () => {
    expect(normalizeText('Crème Brûlée')).toBe('creme brulee')
    expect(normalizeText('half-and-half')).toBe('half and half')
    expect(normalizeText("Grandma's Bake")).toBe('grandma s bake')
  })
})

describe('tokenize', () => {
  it('splits on whitespace and drops empties', () => {
    expect(tokenize('  chicken   soup ')).toEqual(['chicken', 'soup'])
  })

  it('returns nothing for an empty query', () => {
    expect(tokenize('   ')).toEqual([])
  })
})

describe('scoreRecipe', () => {
  it('matches a single title word', () => {
    expect(matches('chicken', chickenSoup)).toBe(true)
  })

  it('matches tokens given out of order — the original complaint', () => {
    // "soup chicken" against "Chicken Noodle Soup" returned nothing before.
    expect(matches('soup chicken', chickenSoup)).toBe(true)
  })

  it('matches a word from the middle of the title', () => {
    expect(matches('noodle', chickenSoup)).toBe(true)
  })

  it('matches on an ingredient the title never mentions', () => {
    expect(matches('mushroom', casserole)).toBe(true)
    expect(matches('mushroom', chickenSoup)).toBe(false)
  })

  it('matches on a description word', () => {
    expect(matches('blue tin', casserole)).toBe(true)
  })

  it('matches on a tag', () => {
    expect(matches('dessert', creme)).toBe(true)
  })

  it('finds accented titles typed without accents', () => {
    expect(matches('creme brulee', creme)).toBe(true)
    expect(matches('brulee', creme)).toBe(true)
  })

  it('matches word prefixes', () => {
    expect(matches('chick', chickenSoup)).toBe(true)
    expect(matches('noodl', chickenSoup)).toBe(true)
  })

  it('does not match a suffix mid-word', () => {
    // "oodle" is inside "noodle" but starts no word — substring matching
    // produces noisy results, prefix matching is what users expect.
    expect(matches('oodle', chickenSoup)).toBe(false)
  })

  it('requires every token to match (AND, not OR)', () => {
    expect(matches('chicken mushroom', chickenSoup)).toBe(false)
    expect(matches('chicken mushroom', casserole)).toBe(true)
  })

  it('returns null rather than 0 for a non-match', () => {
    expect(scoreRecipe(tokenize('pizza'), chickenSoup)).toBeNull()
  })

  it('scores an empty query as neutral so browsing is unaffected', () => {
    expect(scoreRecipe([], chickenSoup)).toBe(0)
  })

  it('ranks a title hit above an ingredient-only hit', () => {
    const titleHit = scoreRecipe(tokenize('chicken'), chickenSoup)!
    const ingredientHit = scoreRecipe(tokenize('chicken'), casserole)!
    expect(titleHit).toBeGreaterThan(ingredientHit)
  })

  it('ranks an exact word above a longer word it merely prefixes', () => {
    const exact = scoreRecipe(tokenize('soup'), { title: 'Soup' })!
    const prefix = scoreRecipe(tokenize('soup'), { title: 'Soupçon of Garlic' })!
    expect(exact).toBeGreaterThan(prefix)
  })

  it('handles recipes with no tags, description, or ingredients', () => {
    expect(matches('bare', { title: 'Bare Recipe' })).toBe(true)
    expect(matches('missing', { title: 'Bare Recipe' })).toBe(false)
  })
})
