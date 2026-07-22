import * as cheerio from 'cheerio'
import type { Cheerio, CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { ParsedRecipe } from './jsonld'
import { parseIsoDuration, parseYield, resolveImageUrl } from './jsonld'

function cleanText(s: string | undefined | null): string | null {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t || null
}

/** itemprop value per the microdata spec: content/datetime attr wins over text. */
function propValue($el: Cheerio<AnyNode>): string | null {
  return cleanText(
    $el.attr('content')
      ?? $el.attr('datetime')
      ?? ($el.is('img, source') ? $el.attr('src') : undefined)
      ?? ($el.is('a, link') ? $el.attr('href') : undefined)
      ?? $el.text(),
  )
}

function extractFromScope($: CheerioAPI, scope: Cheerio<AnyNode>, url: string): ParsedRecipe | null {
  const prop = (name: string) => scope.find(`[itemprop="${name}"]`)

  const title = cleanText(prop('name').first().text())
    ?? cleanText($('h1').first().text())
    ?? cleanText($('title').first().text())

  const ingredients = scope.find('[itemprop="recipeIngredient"], [itemprop="ingredients"]')
    .toArray()
    .map(el => cleanText($(el).text()))
    .filter((v): v is string => v != null)

  const steps: string[] = []
  const instructionEls = prop('recipeInstructions').toArray()
  if (instructionEls.length > 1) {
    for (const el of instructionEls) {
      const t = cleanText($(el).text())
      if (t) steps.push(t)
    }
  }
  else if (instructionEls.length === 1) {
    const container = $(instructionEls[0]!)
    const items = container.find('li, p').toArray()
    if (items.length) {
      for (const el of items) {
        const t = cleanText($(el).text())
        if (t) steps.push(t)
      }
    }
    else {
      for (const line of container.text().split(/\r?\n/)) {
        const t = cleanText(line)
        if (t) steps.push(t)
      }
    }
  }

  if (!title || (ingredients.length === 0 && steps.length === 0)) return null

  const imgEl = prop('image').first()
  const imageRaw = imgEl.length ? propValue(imgEl) : null

  return {
    title,
    description: prop('description').length ? propValue(prop('description').first()) : null,
    ingredients,
    steps,
    prepMinutes: parseIsoDuration(propValue(prop('prepTime').first()) ?? undefined),
    cookMinutes: parseIsoDuration(propValue(prop('cookTime').first()) ?? undefined),
    totalMinutes: parseIsoDuration(propValue(prop('totalTime').first()) ?? undefined),
    servings: parseYield(propValue(prop('recipeYield').first())),
    imageUrl: resolveImageUrl(imageRaw, url),
  }
}

/** Last resort: class-name sniffing for sites with no structured data at all. */
function extractHeuristically($: CheerioAPI, url: string): ParsedRecipe | null {
  const classMatches = (el: AnyNode, re: RegExp): boolean => {
    const own = $(el).attr('class') ?? ''
    const parent = $(el).parent().attr('class') ?? ''
    return re.test(own) || re.test(parent)
  }

  const ingredients = $('li').toArray()
    .filter(el => classMatches(el, /ingredient/i))
    .map(el => cleanText($(el).text()))
    .filter((v): v is string => v != null)

  const steps = $('li, p').toArray()
    .filter(el => classMatches(el, /instruction|direction/i))
    .map(el => cleanText($(el).text()))
    .filter((v): v is string => v != null)

  // Demand real substance — a lone "ingredients" class hit is noise, not a recipe.
  if (ingredients.length < 2 || steps.length === 0) return null

  const title = cleanText($('h1').first().text()) ?? cleanText($('title').first().text())
  if (!title) return null

  return {
    title,
    description: null,
    ingredients,
    steps,
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
    servings: null,
    imageUrl: resolveImageUrl($('meta[property="og:image"]').attr('content'), url),
  }
}

/**
 * Microdata (itemscope/itemprop) extraction, then a class-name heuristic as a
 * last resort. Null when nothing sensible is found.
 */
export function extractRecipeFromMicrodata(html: string, url: string): ParsedRecipe | null {
  const $ = cheerio.load(html)
  for (const el of $('[itemscope][itemtype*="Recipe"]').toArray()) {
    const recipe = extractFromScope($, $(el), url)
    if (recipe) return recipe
  }
  return extractHeuristically($, url)
}
