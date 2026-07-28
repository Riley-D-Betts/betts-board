import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { recipes } from '../../db/schema'
import { uploadsDir } from '../../utils/dataDir'
import { safeFetch, safeFetchText } from '../../utils/safeFetch'
import { extractRecipeFromHtml } from './jsonld'
import { extractRecipeFromMicrodata } from './microdata'
import { createRecipe } from './recipes'
import type { RecipeDetail } from './recipes'

/**
 * Recipe sites are slow, ad-laden and redirect a lot, so the budget is
 * generous — but it is a TOTAL budget that includes reading the body, and it
 * is spent through safeFetch(), which refuses LAN/loopback/metadata addresses
 * on every redirect hop. The URL here is typed by a household member and the
 * image URL is chosen by the remote page, so neither is trusted.
 */
const PAGE_LIMITS = { timeoutMs: 20_000, maxBytes: 5_000_000, maxRedirects: 5 }
// Hero photos are the one legitimately large thing we pull; 10 MB covers an
// unoptimised full-resolution JPEG and still bounds what sharp has to hold.
const IMAGE_LIMITS = { timeoutMs: 20_000, maxBytes: 10_000_000, maxRedirects: 5 }

// Many recipe sites block obvious bots; present as a normal browser.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

/** Download + re-encode the hero image; returns "recipes/<uuid>.jpg" or null on any failure. */
async function downloadHeroImage(imageUrl: string): Promise<string | null> {
  try {
    const res = await safeFetch(imageUrl, { headers: BROWSER_HEADERS, ...IMAGE_LIMITS })
    if (!res.ok) return null
    const buffer = Buffer.from(res.bytes)
    const jpeg = await sharp(buffer)
      .rotate() // honor EXIF orientation
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
    const filename = `${randomUUID()}.jpg`
    writeFileSync(join(uploadsDir('recipes'), filename), jpeg)
    return `recipes/${filename}`
  }
  catch {
    return null // a recipe without a photo is still a recipe
  }
}

/**
 * Fetch a page, extract its recipe (JSON-LD → microdata → heuristics), grab the
 * hero image, and persist everything. Throws a friendly 422 when the page can't
 * be fetched or contains no recognizable recipe.
 */
export async function importRecipeFromUrl(
  db: Db,
  opts: { householdId: string, url: string, profileId?: string },
): Promise<RecipeDetail> {
  let html: string
  try {
    const res = await safeFetchText(opts.url, { headers: BROWSER_HEADERS, ...PAGE_LIMITS })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    html = res.text
  }
  catch {
    // Deliberately one message for every failure — "blocked" must not be
    // distinguishable from "unreachable", or this becomes a LAN scanner.
    throw createError({
      statusCode: 422,
      statusMessage: 'We couldn\'t reach that page. Check the link, or enter the recipe manually.',
    })
  }

  const parsed = extractRecipeFromHtml(html, opts.url) ?? extractRecipeFromMicrodata(html, opts.url)
  if (!parsed) {
    throw createError({
      statusCode: 422,
      statusMessage: 'We couldn\'t find a recipe on that page. You can enter it manually instead.',
    })
  }

  const imagePath = parsed.imageUrl ? await downloadHeroImage(parsed.imageUrl) : null

  const recipe = createRecipe(db, opts.householdId, {
    title: parsed.title,
    description: parsed.description,
    sourceUrl: opts.url,
    prepMinutes: parsed.prepMinutes,
    cookMinutes: parsed.cookMinutes,
    totalMinutes: parsed.totalMinutes,
    servings: parsed.servings,
    steps: parsed.steps,
    tags: null,
    ingredients: parsed.ingredients.map(raw => ({ raw })), // parseIngredient runs per line
  }, opts.profileId)

  if (imagePath) {
    db.update(recipes).set({ imagePath }).where(eq(recipes.id, recipe.id)).run()
    recipe.imagePath = imagePath
  }

  return recipe
}
