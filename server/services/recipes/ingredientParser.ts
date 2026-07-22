/** Best-effort structured parse of one ingredient line. Never throws. */
export interface ParsedIngredient {
  quantity: number | null
  unit: string | null
  name: string | null
  note: string | null
}

const VULGAR_FRACTIONS: Record<string, number> = {
  '¼': 1 / 4, '½': 1 / 2, '¾': 3 / 4,
  '⅐': 1 / 7, '⅑': 1 / 9, '⅒': 1 / 10,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5,
  '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
}
const VULGAR_CLASS = `[${Object.keys(VULGAR_FRACTIONS).join('')}]`

/** Alias → canonical short unit. Lowercased keys except the T/t special case. */
const UNIT_ALIASES: Record<string, string> = {
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup', c: 'cup',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  pinch: 'pinch', pinches: 'pinch',
  clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can',
  stick: 'stick', sticks: 'stick',
  slice: 'slice', slices: 'slice',
  bunch: 'bunch', bunches: 'bunch',
  package: 'pkg', packages: 'pkg', pkg: 'pkg', pkgs: 'pkg',
}

/** Case matters only for the bare-letter units: T = tablespoon, t = teaspoon. */
function canonicalUnit(word: string): string | null {
  const stripped = word.replace(/\.$/, '')
  if (stripped === 'T') return 'tbsp'
  if (stripped === 't') return 'tsp'
  return UNIT_ALIASES[stripped.toLowerCase()] ?? null
}

/** "1½" → "1.5", "½" → "0.5" — turns unicode fractions into plain decimals. */
function normalizeFractions(s: string): string {
  return s
    .replace(new RegExp(`(\\d+)\\s*(${VULGAR_CLASS})`, 'g'),
      (_, int: string, f: string) => String(Number(int) + VULGAR_FRACTIONS[f]!))
    .replace(new RegExp(VULGAR_CLASS, 'g'), f => String(VULGAR_FRACTIONS[f]!))
}

// A single numeric token: mixed number "1 1/2", bare fraction "3/4", or decimal.
const NUM = String.raw`\d+\s+\d+\s*/\s*\d+|\d+\s*/\s*\d+|\d*\.\d+|\d+`
const RANGE_RE = new RegExp(String.raw`^\s*(${NUM})\s*(?:-|–|—|to)\s*(${NUM})\s*`, 'i')
const NUM_RE = new RegExp(String.raw`^\s*(${NUM})\s*`)

function numTokenValue(token: string): number {
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(token.trim())
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(token.trim())
  if (frac) return Number(frac[1]) / Number(frac[2])
  return Number(token)
}

function round(n: number): number | null {
  if (!Number.isFinite(n)) return null
  return Math.round(n * 1000) / 1000
}

/**
 * Parse a raw ingredient line into { quantity, unit, name, note }.
 * Fields are null when they can't be determined; the function never throws.
 */
export function parseIngredient(raw: string): ParsedIngredient {
  try {
    if (typeof raw !== 'string' || !raw.trim()) {
      return { quantity: null, unit: null, name: null, note: null }
    }

    const notes: string[] = []
    let working = normalizeFractions(raw.replace(/\s+/g, ' ').trim())

    // Parentheticals become notes, kept with their parens: "(softened)", "(14 oz)".
    working = working.replace(/\(([^)]*)\)/g, (_, inner: string) => {
      const t = inner.trim()
      if (t) notes.push(`(${t})`)
      return ' '
    }).replace(/\s+/g, ' ').trim()

    // Everything after the first comma is a note: "…, minced", "…, divided".
    const comma = working.indexOf(',')
    if (comma !== -1) {
      const tail = working.slice(comma + 1).trim()
      if (tail) notes.push(tail)
      working = working.slice(0, comma).trim()
    }

    // Quantity: range takes the max ("1-2" → 2, "1 to 2" → 2).
    let quantity: number | null = null
    const range = RANGE_RE.exec(working)
    if (range) {
      quantity = round(Math.max(numTokenValue(range[1]!), numTokenValue(range[2]!)))
      working = working.slice(range[0].length)
    }
    else {
      const num = NUM_RE.exec(working)
      if (num) {
        quantity = round(numTokenValue(num[1]!))
        working = working.slice(num[0].length)
      }
    }

    // Unit: first word, only when it maps through the alias table.
    let unit: string | null = null
    const wordMatch = /^([A-Za-z]+\.?)(?:\s+|$)/.exec(working)
    if (wordMatch) {
      const mapped = canonicalUnit(wordMatch[1]!)
      if (mapped) {
        unit = mapped
        working = working.slice(wordMatch[0].length)
        working = working.replace(/^of\s+/i, '') // "cup of flour" → "flour"
      }
    }

    const name = working.trim() || null
    return {
      quantity,
      unit,
      name,
      note: notes.length ? notes.join(', ') : null,
    }
  }
  catch {
    return { quantity: null, unit: null, name: typeof raw === 'string' ? raw.trim() || null : null, note: null }
  }
}
