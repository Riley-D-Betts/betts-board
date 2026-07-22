import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractRecipeFromHtml, parseIsoDuration, parseYield, resolveImageUrl } from '../../server/services/recipes/jsonld'
import { extractRecipeFromMicrodata } from '../../server/services/recipes/microdata'

const FIXTURES = fileURLToPath(new URL('../fixtures/recipes', import.meta.url))
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8')

describe('extractRecipeFromHtml (JSON-LD)', () => {
  it('extracts a plain Recipe node and skips a malformed ld+json block', () => {
    const r = extractRecipeFromHtml(fixture('plain-jsonld.html'), 'https://mapleandwhisk.test/recipes/buttermilk-pancakes')
    expect(r).not.toBeNull()
    expect(r!.title).toBe('Classic Buttermilk Pancakes')
    expect(r!.description).toContain('diner-style')
    expect(r!.ingredients).toHaveLength(6)
    expect(r!.ingredients[0]).toBe('2 cups all-purpose flour')
    expect(r!.steps).toHaveLength(3)
    expect(r!.steps[0]).toBe('Whisk the dry ingredients together in a large bowl.')
    expect(r!.prepMinutes).toBe(10)
    expect(r!.cookMinutes).toBe(15)
    expect(r!.totalMinutes).toBe(25)
    expect(r!.servings).toBe(4)
    // relative image resolved against the page URL
    expect(r!.imageUrl).toBe('https://mapleandwhisk.test/images/pancakes-hero.jpg')
  })

  it('finds the Recipe inside an @graph among WebPage/Person nodes', () => {
    const r = extractRecipeFromHtml(fixture('graph-jsonld.html'), 'https://theweekendtable.test/pot-roast/')
    expect(r).not.toBeNull()
    expect(r!.title).toBe('Sunday Pot Roast')
    expect(r!.ingredients).toHaveLength(5)
    // plain-string instructions array
    expect(r!.steps).toHaveLength(3)
    expect(r!.steps[1]).toContain('braise at 300F')
    expect(r!.cookMinutes).toBe(180)
    expect(r!.totalMinutes).toBe(200)
    // ImageObject → url
    expect(r!.imageUrl).toBe('https://cdn.theweekendtable.test/img/pot-roast-1600.jpg')
    // recipeYield array → first parseable number
    expect(r!.servings).toBe(8)
  })

  it('accepts @type arrays like ["Recipe","NewsArticle"] and splits string instructions on newlines', () => {
    const r = extractRecipeFromHtml(fixture('array-types.html'), 'https://citysupper.test/noodles/garlic')
    expect(r).not.toBeNull()
    expect(r!.title).toBe('Midnight Garlic Noodles')
    expect(r!.ingredients).toHaveLength(5)
    expect(r!.steps).toHaveLength(3)
    expect(r!.steps[0]).toBe('Boil the noodles until just underdone, then drain.')
    expect(r!.servings).toBe(2)
    expect(r!.prepMinutes).toBe(5)
    expect(r!.totalMinutes).toBeNull()
    // image array of relative paths → first one, absolutized
    expect(r!.imageUrl).toBe('https://citysupper.test/noodles/images/garlic-noodles-square.jpg')
  })

  it('flattens HowToSection instructions, prefixing section names, and parses PT1H30M', () => {
    const r = extractRecipeFromHtml(fixture('howto-sections.html'), 'https://trattoria.test/lasagna')
    expect(r).not.toBeNull()
    expect(r!.title).toBe('Lasagna alla Bolognese')
    expect(r!.steps).toEqual([
      'Make the ragu:',
      'Brown the meat with onion, carrot, and celery.',
      'Add tomatoes and simmer gently for 45 minutes.',
      'Assemble and bake:',
      'Whisk the besciamella until thick and season with nutmeg.',
      'Layer pasta, ragu, and besciamella; top with Parmigiano.',
      'Bake at 375F until bubbling and browned, about 40 minutes.',
    ])
    expect(r!.prepMinutes).toBe(30)
    expect(r!.cookMinutes).toBe(60)
    expect(r!.totalMinutes).toBe(90)
    // "one 9x13 pan (8 portions)" — first parseable number wins
    expect(r!.servings).toBe(9)
    expect(r!.ingredients).toHaveLength(6)
  })

  it('returns null for a page without any Recipe node', () => {
    expect(extractRecipeFromHtml(fixture('no-recipe.html'), 'https://gearweekly.test/skillets')).toBeNull()
  })

  it('returns null for a microdata-only page (no JSON-LD present)', () => {
    expect(extractRecipeFromHtml(fixture('microdata-only.html'), 'https://hearth.test/recipes/soup.html')).toBeNull()
  })
})

describe('extractRecipeFromMicrodata', () => {
  it('catches the microdata-only page the JSON-LD extractor misses', () => {
    const r = extractRecipeFromMicrodata(fixture('microdata-only.html'), 'https://hearth.test/recipes/soup.html')
    expect(r).not.toBeNull()
    expect(r!.title).toBe("Grandma's Chicken Noodle Soup")
    expect(r!.ingredients).toHaveLength(5)
    expect(r!.ingredients[4]).toBe('8 oz egg noodles')
    expect(r!.steps).toHaveLength(3)
    expect(r!.steps[0]).toContain('simmer with aromatics')
    expect(r!.prepMinutes).toBe(15)
    expect(r!.cookMinutes).toBe(45)
    expect(r!.servings).toBe(6)
    // ../photos resolved against the page URL
    expect(r!.imageUrl).toBe('https://hearth.test/photos/chicken-soup.jpg')
  })

  it('returns null when neither microdata nor heuristics find a recipe', () => {
    expect(extractRecipeFromMicrodata(fixture('no-recipe.html'), 'https://gearweekly.test/skillets')).toBeNull()
  })
})

describe('helpers', () => {
  it('parses ISO-8601 durations to minutes', () => {
    expect(parseIsoDuration('PT1H30M')).toBe(90)
    expect(parseIsoDuration('PT45M')).toBe(45)
    expect(parseIsoDuration('PT2H')).toBe(120)
    expect(parseIsoDuration('P1DT2H')).toBe(1560)
    expect(parseIsoDuration('PT90S')).toBe(2) // rounded
    expect(parseIsoDuration('nonsense')).toBeNull()
    expect(parseIsoDuration(undefined)).toBeNull()
  })

  it('parses recipeYield shapes', () => {
    expect(parseYield(6)).toBe(6)
    expect(parseYield('4 servings')).toBe(4)
    expect(parseYield(['12 cookies', '1 dozen'])).toBe(12)
    expect(parseYield('a crowd')).toBeNull()
    expect(parseYield(null)).toBeNull()
  })

  it('resolves image shapes to absolute URLs', () => {
    const page = 'https://example.test/recipes/pie'
    expect(resolveImageUrl('/img/pie.jpg', page)).toBe('https://example.test/img/pie.jpg')
    expect(resolveImageUrl(['a.jpg', 'b.jpg'], page)).toBe('https://example.test/recipes/a.jpg')
    expect(resolveImageUrl({ url: 'https://cdn.test/pie.jpg' }, page)).toBe('https://cdn.test/pie.jpg')
    expect(resolveImageUrl(undefined, page)).toBeNull()
  })
})
