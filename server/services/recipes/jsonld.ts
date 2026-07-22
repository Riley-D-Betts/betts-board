import * as cheerio from 'cheerio'

/** Normalized output of the schema.org extractors — feeds straight into recipe insert. */
export interface ParsedRecipe {
  title: string
  description: string | null
  ingredients: string[] // raw lines, exactly as authored
  steps: string[]
  prepMinutes: number | null
  cookMinutes: number | null
  totalMinutes: number | null
  servings: number | null
  imageUrl: string | null // absolute, resolved against the page URL
}

/** ISO-8601 duration (PT1H30M, P0DT45M, PT90S…) → whole minutes, or null. */
export function parseIsoDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
    .exec(value.trim())
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined && m[4] === undefined)) return null
  const days = Number(m[1] ?? 0)
  const hours = Number(m[2] ?? 0)
  const minutes = Number(m[3] ?? 0)
  const seconds = Number(m[4] ?? 0)
  return Math.round(days * 1440 + hours * 60 + minutes + seconds / 60)
}

/** recipeYield: number | string | array | QuantitativeValue → first parseable number. */
export function parseYield(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (Array.isArray(value)) {
    for (const v of value) {
      const n = parseYield(v)
      if (n != null) return n
    }
    return null
  }
  if (typeof value === 'string') {
    const m = /\d+(?:\.\d+)?/.exec(value)
    if (!m) return null
    const n = Number(m[0])
    return Number.isFinite(n) && n > 0 ? n : null
  }
  if (typeof value === 'object') return parseYield((value as Record<string, unknown>).value)
  return null
}

/** image: string | array | ImageObject ({url}) → absolute URL against the page URL. */
export function resolveImageUrl(value: unknown, pageUrl: string): string | null {
  if (value == null) return null
  if (Array.isArray(value)) {
    for (const v of value) {
      const u = resolveImageUrl(v, pageUrl)
      if (u) return u
    }
    return null
  }
  if (typeof value === 'object') return resolveImageUrl((value as Record<string, unknown>).url, pageUrl)
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return new URL(value.trim(), pageUrl).href
  }
  catch {
    return null
  }
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.replace(/\s+/g, ' ').trim()
    return t || null
  }
  return null
}

/** True when @type (string | array) is or includes "Recipe", case-insensitively. */
function isRecipeType(type: unknown): boolean {
  if (typeof type === 'string') return type.toLowerCase() === 'recipe'
  if (Array.isArray(type)) return type.some(t => typeof t === 'string' && t.toLowerCase() === 'recipe')
  return false
}

/** Search a parsed JSON-LD value (node, array, or @graph container) for a Recipe node. */
function findRecipeNode(data: unknown): Record<string, unknown> | null {
  const queue: unknown[] = [data]
  while (queue.length) {
    const item = queue.shift()
    if (item == null) continue
    if (Array.isArray(item)) {
      queue.push(...item)
      continue
    }
    if (typeof item !== 'object') continue
    const node = item as Record<string, unknown>
    if (isRecipeType(node['@type'])) return node
    if (node['@graph']) queue.push(node['@graph'])
    // Some publishers nest the recipe under mainEntity / mainEntityOfPage.
    if (node.mainEntity) queue.push(node.mainEntity)
  }
  return null
}

/** One instruction entry: string | HowToStep | HowToSection → flat step strings. */
function flattenInstruction(entry: unknown, out: string[]): void {
  if (entry == null) return
  if (typeof entry === 'string') {
    for (const line of entry.split(/\r?\n/)) {
      const t = line.replace(/\s+/g, ' ').trim()
      if (t) out.push(t)
    }
    return
  }
  if (Array.isArray(entry)) {
    for (const e of entry) flattenInstruction(e, out)
    return
  }
  if (typeof entry !== 'object') return
  const node = entry as Record<string, unknown>
  const items = node.itemListElement
  if (items != null) {
    // HowToSection: prefix the section name as its own "SectionName:" step.
    const sectionName = asText(node.name)
    if (sectionName) out.push(`${sectionName}:`)
    flattenInstruction(items, out)
    return
  }
  const text = asText(node.text) ?? asText(node.name)
  if (text) out.push(text)
}

function parseInstructions(value: unknown): string[] {
  const out: string[] = []
  flattenInstruction(value, out)
  return out
}

function parseIngredientLines(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  }
  if (!Array.isArray(value)) return []
  return value
    .map(v => asText(v))
    .filter((v): v is string => v != null)
}

function mapRecipeNode(node: Record<string, unknown>, pageUrl: string): ParsedRecipe | null {
  const title = asText(node.name)
  if (!title) return null
  return {
    title,
    description: asText(node.description),
    ingredients: parseIngredientLines(node.recipeIngredient ?? node.ingredients),
    steps: parseInstructions(node.recipeInstructions),
    prepMinutes: parseIsoDuration(node.prepTime),
    cookMinutes: parseIsoDuration(node.cookTime),
    totalMinutes: parseIsoDuration(node.totalTime),
    servings: parseYield(node.recipeYield),
    imageUrl: resolveImageUrl(node.image, pageUrl),
  }
}

/**
 * Extract a recipe from a page's JSON-LD blocks. Tolerates malformed JSON
 * per-block, @graph containers, and array @type values. Null when no Recipe
 * node is present anywhere.
 */
export function extractRecipeFromHtml(html: string, url: string): ParsedRecipe | null {
  const $ = cheerio.load(html)
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const raw = $(el).text()
    if (!raw?.trim()) continue
    let data: unknown
    try {
      data = JSON.parse(raw)
    }
    catch {
      continue // one bad block must not sink the others
    }
    const node = findRecipeNode(data)
    if (!node) continue
    const recipe = mapRecipeNode(node, url)
    if (recipe) return recipe
  }
  return null
}
