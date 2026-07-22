/** Unit families, canonical conversion and kitchen-friendly formatting for
 * shopping aggregation. Canonical amounts are ml (volume) and g (mass). */

export type UnitFamily = 'volume' | 'mass'

const VOLUME_ML: Record<string, number> = {
  tsp: 4.93, tbsp: 14.79, floz: 29.57, cup: 236.6, pt: 473.2, qt: 946.4, gal: 3785, ml: 1, l: 1000,
}

const MASS_G: Record<string, number> = { g: 1, kg: 1000, oz: 28.35, lb: 453.6 }

/** Alias → canonical short unit (only units we can convert). */
const UNIT_ALIASES: Record<string, string> = {
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup', c: 'cup',
  floz: 'floz', 'fl oz': 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz',
  pt: 'pt', pts: 'pt', pint: 'pt', pints: 'pt',
  qt: 'qt', qts: 'qt', quart: 'qt', quarts: 'qt',
  gal: 'gal', gals: 'gal', gallon: 'gal', gallons: 'gal',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', cc: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
}

/** Map a free-typed unit onto a canonical short unit, or null when unknown. */
export function normalizeUnit(unit: string): string | null {
  const key = unit.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ')
  return UNIT_ALIASES[key] ?? UNIT_ALIASES[key.replace(/\s/g, '')] ?? null
}

/**
 * Convert a quantity in a known unit to its family's canonical amount
 * (ml for volume, g for mass). Unknown units → null = opaque, don't merge.
 */
export function toCanonical(quantity: number, unit: string | null | undefined):
{ family: UnitFamily, amount: number } | null {
  if (unit == null || !Number.isFinite(quantity)) return null
  const u = normalizeUnit(unit)
  if (!u) return null
  if (u in VOLUME_ML) return { family: 'volume', amount: quantity * VOLUME_ML[u]! }
  if (u in MASS_G) return { family: 'mass', amount: quantity * MASS_G[u]! }
  return null
}

// Display units, largest first. `min` = smallest canonical amount that still
// reads naturally in that unit (¼ cup rather than 4 tbsp, but 3 tbsp not 0.19 cup).
const VOLUME_DISPLAY = [
  { unit: 'gal', size: VOLUME_ML.gal!, min: VOLUME_ML.gal! },
  { unit: 'qt', size: VOLUME_ML.qt!, min: VOLUME_ML.qt! },
  { unit: 'cup', size: VOLUME_ML.cup!, min: VOLUME_ML.cup! / 4 },
  { unit: 'tbsp', size: VOLUME_ML.tbsp!, min: VOLUME_ML.tbsp! }, // below 1 tbsp → tsp
  { unit: 'tsp', size: VOLUME_ML.tsp!, min: 0 },
]
const MASS_DISPLAY = [
  { unit: 'lb', size: MASS_G.lb!, min: MASS_G.lb! },
  { unit: 'oz', size: MASS_G.oz!, min: MASS_G.oz! },
  { unit: 'g', size: 1, min: 0 },
]

const KITCHEN_FRACTIONS: [number, string][] = [
  [0, ''], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'], [1, ''],
]

/** "1.25" → "1¼", "0.5" → "½", "2" → "2"; null when no kitchen fraction fits. */
function kitchenNumber(value: number): string | null {
  const whole = Math.floor(value + 1e-9)
  const frac = value - whole
  let best: { d: number, fr: number, glyph: string } | null = null
  for (const [fr, glyph] of KITCHEN_FRACTIONS) {
    const d = Math.abs(frac - fr)
    if (!best || d < best.d) best = { d, fr, glyph }
  }
  if (!best || best.d > 0.05) return null
  let w = whole
  let glyph = best.glyph
  if (best.fr === 1) {
    w += 1
    glyph = ''
  }
  if (glyph) return w > 0 ? `${w}${glyph}` : glyph
  return String(w)
}

/** Format a plain count with kitchen fractions ("2", "1½"). */
export function formatCount(n: number): string {
  return kitchenNumber(n) ?? String(Math.round(n * 100) / 100)
}

/**
 * Render a canonical amount (ml or g) in the largest natural unit with
 * kitchen fractions: "2¼ cups", "1½ lb", "2 tsp".
 */
export function formatQuantity(amount: number, family: UnitFamily): string {
  const table = family === 'volume' ? VOLUME_DISPLAY : MASS_DISPLAY
  const pick = table.find(t => amount >= t.min * 0.98) ?? table[table.length - 1]!
  const value = amount / pick.size
  if (pick.unit === 'g') return `${Math.round(value)} g`
  const num = formatCount(value)
  const label = pick.unit === 'cup' && value > 1.02 ? 'cups' : pick.unit
  return `${num} ${label}`
}

/**
 * Normalize an ingredient/item name into a merge key: lowercase, trim,
 * parentheticals stripped, everything after the first comma dropped,
 * whitespace collapsed.
 */
export function normalizeNameKey(name: string): string {
  let s = name.toLowerCase().replace(/\([^)]*\)/g, ' ')
  const comma = s.indexOf(',')
  if (comma !== -1) s = s.slice(0, comma)
  return s.replace(/\s+/g, ' ').trim()
}

// -- Light quantity-prefix parse for quick-add ("2 lbs chicken") ----------

/** Opaque count-ish units we still recognize as a unit word in quick-add. */
const OPAQUE_UNIT_ALIASES: Record<string, string> = {
  can: 'can', cans: 'can',
  clove: 'clove', cloves: 'clove',
  bunch: 'bunch', bunches: 'bunch',
  bag: 'bag', bags: 'bag',
  box: 'box', boxes: 'box',
  jar: 'jar', jars: 'jar',
  bottle: 'bottle', bottles: 'bottle',
  pack: 'pack', packs: 'pack', pkg: 'pkg', pkgs: 'pkg',
  dozen: 'dozen',
  head: 'head', heads: 'head',
  stick: 'stick', sticks: 'stick',
  loaf: 'loaf', loaves: 'loaf',
}

export interface ParsedItemInput {
  name: string
  quantity: number | null
  unit: string | null
  displayQuantity: string | null
}

function numToken(token: string): number {
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(token)
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(token)
  if (frac) return Number(frac[1]) / Number(frac[2])
  return Number(token)
}

/**
 * Parse a free-typed shopping line into { quantity, unit, name }.
 * "2 lbs chicken" → { quantity: 2, unit: 'lb', name: 'chicken', displayQuantity: '2 lbs' }.
 * No leading number → the whole text is the name.
 */
export function parseItemInput(text: string): ParsedItemInput {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  const numMatch = /^(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d*\.\d+|\d+)\s*/.exec(trimmed)
  if (!numMatch) return { name: trimmed, quantity: null, unit: null, displayQuantity: null }

  const quantity = numToken(numMatch[1]!)
  let rest = trimmed.slice(numMatch[0].length)
  let unit: string | null = null
  let unitText = ''

  const wordMatch = /^([A-Za-z]+\.?)(?:\s+|$)/.exec(rest)
  if (wordMatch) {
    const raw = wordMatch[1]!
    const bare = raw.replace(/\.$/, '').toLowerCase()
    const mapped = normalizeUnit(raw) ?? OPAQUE_UNIT_ALIASES[bare] ?? null
    // Only consume the word as a unit when something is left to be the name.
    if (mapped && rest.slice(wordMatch[0].length).trim()) {
      unit = mapped
      unitText = raw
      rest = rest.slice(wordMatch[0].length).replace(/^of\s+/i, '')
    }
  }

  const name = rest.trim()
  if (!name) return { name: trimmed, quantity: null, unit: null, displayQuantity: null }
  return {
    name,
    quantity,
    unit,
    displayQuantity: unitText ? `${numMatch[1]} ${unitText}` : numMatch[1]!,
  }
}
