import { and, asc, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import type { RecipeCreate, RecipePatch } from '#shared/schemas/recipes'
import type { Db } from '../../db/client'
import { profiles, recipeIngredients, recipeNotes, recipeRatings, recipes } from '../../db/schema'
import { parseIngredient } from './ingredientParser'

type RecipeRow = typeof recipes.$inferSelect
type IngredientRow = typeof recipeIngredients.$inferSelect

export interface RecipeListItem extends RecipeRow {
  avgRating: number | null
  ratingCount: number
  myRating: number | null
}

export interface RecipeDetail extends RecipeRow {
  ingredients: IngredientRow[]
  avgRating: number | null
  ratingCount: number
  myRating: number | null
  notes: Array<{
    id: string
    body: string
    createdAt: Date
    author: { id: string, name: string, color: string, avatarPath: string | null } | null
  }>
}

type IngredientInput = RecipeCreate['ingredients'][number]

/** Fill in parsed fields from the raw line when the client didn't provide any. */
function resolveIngredient(ing: IngredientInput) {
  const hasParsed = ing.quantity !== undefined || ing.unit !== undefined
    || ing.name !== undefined || ing.note !== undefined
  if (hasParsed) {
    return {
      quantity: ing.quantity ?? null,
      unit: ing.unit ?? null,
      name: ing.name ?? null,
      note: ing.note ?? null,
    }
  }
  return parseIngredient(ing.raw)
}

function insertIngredients(db: Db, recipeId: string, ingredients: IngredientInput[]) {
  if (!ingredients.length) return
  db.insert(recipeIngredients).values(
    ingredients.map((ing, i) => ({
      recipeId,
      sortOrder: i,
      raw: ing.raw,
      ...resolveIngredient(ing),
    })),
  ).run()
}

function ratingSummaries(db: Db, recipeIds: string[], profileId?: string) {
  const byRecipe = new Map<string, { sum: number, count: number, mine: number | null }>()
  if (!recipeIds.length) return byRecipe
  const rows = db.select().from(recipeRatings)
    .where(inArray(recipeRatings.recipeId, recipeIds))
    .all()
  for (const r of rows) {
    const agg = byRecipe.get(r.recipeId) ?? { sum: 0, count: 0, mine: null }
    agg.sum += r.rating
    agg.count += 1
    if (profileId && r.profileId === profileId) agg.mine = r.rating
    byRecipe.set(r.recipeId, agg)
  }
  return byRecipe
}

function withRatings<T extends RecipeRow>(row: T, agg?: { sum: number, count: number, mine: number | null }) {
  return {
    ...row,
    avgRating: agg && agg.count ? Math.round((agg.sum / agg.count) * 10) / 10 : null,
    ratingCount: agg?.count ?? 0,
    myRating: agg?.mine ?? null,
  }
}

export function listRecipes(
  db: Db,
  householdId: string,
  query: { q?: string, tag?: string, sort: 'recent' | 'rating' | 'title' },
  profileId?: string,
): RecipeListItem[] {
  let rows = db.select().from(recipes)
    .where(eq(recipes.householdId, householdId))
    .all()

  if (query.q) {
    const needle = query.q.toLowerCase()
    rows = rows.filter(r => r.title.toLowerCase().includes(needle))
  }
  if (query.tag) {
    const tag = query.tag.toLowerCase()
    rows = rows.filter(r => (r.tags ?? []).some(t => t.toLowerCase() === tag))
  }

  const aggs = ratingSummaries(db, rows.map(r => r.id), profileId)
  const items = rows.map(r => withRatings(r, aggs.get(r.id)))

  switch (query.sort) {
    case 'rating':
      items.sort((a, b) => (b.avgRating ?? -1) - (a.avgRating ?? -1)
        || b.ratingCount - a.ratingCount
        || b.createdAt.getTime() - a.createdAt.getTime())
      break
    case 'title':
      items.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
      break
    default: // recent
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }
  return items
}

function requireRecipe(db: Db, householdId: string, id: string): RecipeRow {
  const row = db.select().from(recipes)
    .where(and(eq(recipes.id, id), eq(recipes.householdId, householdId)))
    .get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Recipe not found' })
  return row
}

export function getRecipe(db: Db, householdId: string, id: string, profileId?: string): RecipeDetail {
  const row = requireRecipe(db, householdId, id)

  const ingredients = db.select().from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, id))
    .orderBy(asc(recipeIngredients.sortOrder))
    .all()

  const agg = ratingSummaries(db, [id], profileId).get(id)

  const notes = db.select({
    id: recipeNotes.id,
    body: recipeNotes.body,
    createdAt: recipeNotes.createdAt,
    authorId: profiles.id,
    authorName: profiles.name,
    authorColor: profiles.color,
    authorAvatarPath: profiles.avatarPath,
  }).from(recipeNotes)
    .leftJoin(profiles, eq(recipeNotes.profileId, profiles.id))
    .where(eq(recipeNotes.recipeId, id))
    .orderBy(asc(recipeNotes.createdAt))
    .all()
    .map(n => ({
      id: n.id,
      body: n.body,
      createdAt: n.createdAt,
      author: n.authorId
        ? { id: n.authorId, name: n.authorName!, color: n.authorColor!, avatarPath: n.authorAvatarPath }
        : null,
    }))

  return { ...withRatings(row, agg), ingredients, notes }
}

export function createRecipe(db: Db, householdId: string, input: RecipeCreate, profileId?: string): RecipeDetail {
  const row = db.insert(recipes).values({
    householdId,
    title: input.title,
    description: input.description ?? null,
    sourceUrl: input.sourceUrl ?? null,
    prepMinutes: input.prepMinutes ?? null,
    cookMinutes: input.cookMinutes ?? null,
    totalMinutes: input.totalMinutes ?? null,
    servings: input.servings ?? null,
    steps: input.steps,
    tags: input.tags?.length ? input.tags : null,
    createdByProfileId: profileId ?? null,
  }).returning().get()

  insertIngredients(db, row.id, input.ingredients)
  return getRecipe(db, householdId, row.id, profileId)
}

export function updateRecipe(db: Db, householdId: string, id: string, patch: RecipePatch, profileId?: string): RecipeDetail {
  requireRecipe(db, householdId, id)

  db.update(recipes).set({
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.description !== undefined && { description: patch.description ?? null }),
    ...(patch.sourceUrl !== undefined && { sourceUrl: patch.sourceUrl ?? null }),
    ...(patch.prepMinutes !== undefined && { prepMinutes: patch.prepMinutes ?? null }),
    ...(patch.cookMinutes !== undefined && { cookMinutes: patch.cookMinutes ?? null }),
    ...(patch.totalMinutes !== undefined && { totalMinutes: patch.totalMinutes ?? null }),
    ...(patch.servings !== undefined && { servings: patch.servings ?? null }),
    ...(patch.steps !== undefined && { steps: patch.steps }),
    ...(patch.tags !== undefined && { tags: patch.tags?.length ? patch.tags : null }),
    updatedAt: new Date(),
  }).where(eq(recipes.id, id)).run()

  if (patch.ingredients !== undefined) {
    db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id)).run()
    insertIngredients(db, id, patch.ingredients)
  }

  return getRecipe(db, householdId, id, profileId)
}

export function deleteRecipe(db: Db, householdId: string, id: string) {
  requireRecipe(db, householdId, id)
  db.delete(recipes).where(eq(recipes.id, id)).run()
  return { ok: true }
}

/** Upsert the acting profile's 1–5 rating; returns the fresh summary. */
export function rateRecipe(db: Db, householdId: string, id: string, profileId: string, rating: number) {
  requireRecipe(db, householdId, id)
  db.insert(recipeRatings)
    .values({ recipeId: id, profileId, rating })
    .onConflictDoUpdate({
      target: [recipeRatings.recipeId, recipeRatings.profileId],
      set: { rating, updatedAt: new Date() },
    })
    .run()
  const agg = ratingSummaries(db, [id], profileId).get(id)
  return {
    avgRating: agg && agg.count ? Math.round((agg.sum / agg.count) * 10) / 10 : null,
    ratingCount: agg?.count ?? 0,
    myRating: agg?.mine ?? null,
  }
}

export function addNote(db: Db, householdId: string, recipeId: string, profileId: string, body: string) {
  requireRecipe(db, householdId, recipeId)
  return db.insert(recipeNotes).values({ recipeId, profileId, body }).returning().get()
}

/** Author may delete their own note; admins may delete any. */
export function deleteNote(db: Db, householdId: string, recipeId: string, noteId: string, actor: { id: string, role: string }) {
  requireRecipe(db, householdId, recipeId)
  const note = db.select().from(recipeNotes)
    .where(and(eq(recipeNotes.id, noteId), eq(recipeNotes.recipeId, recipeId)))
    .get()
  if (!note) throw createError({ statusCode: 404, statusMessage: 'Note not found' })
  if (note.profileId !== actor.id && actor.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Only the author or an admin can delete this note' })
  }
  db.delete(recipeNotes).where(eq(recipeNotes.id, noteId)).run()
  return { ok: true }
}
