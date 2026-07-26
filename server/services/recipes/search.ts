/**
 * Recipe search scoring.
 *
 * The old filter was `title.toLowerCase().includes(query)` — technically
 * "contains", but title-only and whole-phrase, which is why it felt like a
 * prefix match: "soup chicken" found nothing, and no ingredient or description
 * word ever matched.
 *
 * Now: every whitespace-separated token must match (AND), and a token matches
 * as a word prefix in any searchable field. Kept as a pure function over a
 * plain document so it tests without a database.
 */

export interface SearchDoc {
  title: string
  description?: string | null
  tags?: string[] | null
  /** Ingredient `name` and `raw` lines, already flattened. */
  ingredients?: string[]
}

/** Field weights — a title hit should outrank the same word buried in a step. */
const WEIGHT = { title: 3, tag: 2, ingredient: 1, description: 0.5 } as const

/**
 * Lowercase, strip diacritics, and collapse punctuation to spaces so
 * "crème brûlée" is reachable by typing "creme brulee", and "half-and-half"
 * by typing "half".
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function tokenize(query: string): string[] {
  const normalized = normalizeText(query)
  return normalized ? normalized.split(' ').filter(Boolean) : []
}

/** True when `token` starts any word in the normalized haystack. */
function matchesWordPrefix(haystackWords: string[], token: string): boolean {
  return haystackWords.some(w => w.startsWith(token))
}

function words(value: string): string[] {
  const normalized = normalizeText(value)
  return normalized ? normalized.split(' ') : []
}

/**
 * Returns a relevance score, or null when the document doesn't match every
 * token. Null (not 0) so callers can distinguish "no match" from "weak match".
 */
export function scoreRecipe(tokens: string[], doc: SearchDoc): number | null {
  if (!tokens.length) return 0

  const fields = [
    { words: words(doc.title), weight: WEIGHT.title },
    { words: (doc.tags ?? []).flatMap(words), weight: WEIGHT.tag },
    { words: (doc.ingredients ?? []).flatMap(words), weight: WEIGHT.ingredient },
    { words: words(doc.description ?? ''), weight: WEIGHT.description },
  ]

  let score = 0
  for (const token of tokens) {
    let best = 0
    for (const field of fields) {
      if (!matchesWordPrefix(field.words, token)) continue
      // An exact word beats a prefix of a longer word.
      const exact = field.words.includes(token)
      best = Math.max(best, field.weight * (exact ? 1.5 : 1))
    }
    if (best === 0) return null // every token must match somewhere
    score += best
  }

  // Small bump when the title itself starts with the query — "chicken soup"
  // should lead for the query "chicken".
  const titleWords = words(doc.title)
  if (titleWords.length && tokens[0] && titleWords[0]?.startsWith(tokens[0])) score += 1

  return score
}
