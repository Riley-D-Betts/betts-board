import { and, asc, eq, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import type {
  WishlistCreate, WishlistDto, WishlistItemCreate, WishlistItemDto, WishlistPatch,
} from '#shared/schemas/wishlists'
import type { Db } from '../../db/client'
import { profiles, wishlistItems, wishlists } from '../../db/schema'

type WishlistRow = typeof wishlists.$inferSelect
type ItemRow = typeof wishlistItems.$inferSelect

/** Lists are shared: everyone in the household reads every list. Writes are
 *  the owner's, plus any adult/admin — so a parent can add to a toddler's. */
export function canEditList(list: WishlistRow, actor: { id: string, role: string }): boolean {
  return actor.role === 'admin' || actor.role === 'adult' || list.profileId === actor.id
}

function toItemDto(row: ItemRow): WishlistItemDto {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    notes: row.notes,
    price: row.price,
    priority: row.priority,
    sortOrder: row.sortOrder,
  }
}

function toDto(
  row: WishlistRow,
  owner: { name: string, color: string } | undefined,
  itemCount: number,
  items?: ItemRow[],
): WishlistDto {
  return {
    id: row.id,
    profileId: row.profileId,
    profileName: owner?.name ?? 'Someone',
    profileColor: owner?.color ?? '#94a3b8',
    title: row.title,
    occasion: row.occasion,
    eventDate: row.eventDate,
    sortOrder: row.sortOrder,
    itemCount,
    ...(items ? { items: items.map(toItemDto) } : {}),
  }
}

export function listWishlists(db: Db, householdId: string): WishlistDto[] {
  const rows = db.select().from(wishlists)
    .where(and(eq(wishlists.householdId, householdId), isNull(wishlists.archivedAt)))
    .orderBy(asc(wishlists.sortOrder), asc(wishlists.createdAt))
    .all()
  if (!rows.length) return []

  const owners = new Map(db.select().from(profiles)
    .where(eq(profiles.householdId, householdId)).all()
    .map(p => [p.id, p]))

  // One pass for counts rather than a query per list.
  const counts = new Map<string, number>()
  for (const item of db.select().from(wishlistItems).all()) {
    counts.set(item.wishlistId, (counts.get(item.wishlistId) ?? 0) + 1)
  }

  return rows.map(r => toDto(r, owners.get(r.profileId), counts.get(r.id) ?? 0))
}

export function getWishlist(db: Db, householdId: string, id: string): WishlistDto {
  const row = requireList(db, householdId, id)
  const owner = db.select().from(profiles).where(eq(profiles.id, row.profileId)).get()
  const items = db.select().from(wishlistItems)
    .where(eq(wishlistItems.wishlistId, id))
    .orderBy(asc(wishlistItems.sortOrder), asc(wishlistItems.createdAt))
    .all()
  return toDto(row, owner, items.length, items)
}

/** Throws 404 rather than leaking whether the id exists in another household. */
export function requireList(db: Db, householdId: string, id: string): WishlistRow {
  const row = db.select().from(wishlists)
    .where(and(eq(wishlists.id, id), eq(wishlists.householdId, householdId)))
    .get()
  if (!row || row.archivedAt) throw createError({ statusCode: 404, statusMessage: 'Wish list not found' })
  return row
}

export function createWishlist(
  db: Db,
  householdId: string,
  input: WishlistCreate,
  actorProfileId: string,
): WishlistDto {
  const profileId = input.profileId ?? actorProfileId
  const owner = db.select().from(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.householdId, householdId)))
    .get()
  if (!owner) throw createError({ statusCode: 400, statusMessage: 'Unknown profile' })

  const row = db.insert(wishlists).values({
    householdId,
    profileId,
    title: input.title,
    occasion: input.occasion ?? null,
    eventDate: input.eventDate ?? null,
    sortOrder: input.sortOrder ?? 0,
  }).returning().get()
  return toDto(row, owner, 0, [])
}

export function updateWishlist(
  db: Db,
  householdId: string,
  id: string,
  patch: WishlistPatch,
): WishlistDto {
  requireList(db, householdId, id)
  db.update(wishlists).set({
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.occasion !== undefined && { occasion: patch.occasion ?? null }),
    ...(patch.eventDate !== undefined && { eventDate: patch.eventDate ?? null }),
    ...(patch.profileId !== undefined && { profileId: patch.profileId }),
    ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
    ...(patch.archived !== undefined && { archivedAt: patch.archived ? new Date() : null }),
  }).where(eq(wishlists.id, id)).run()
  return getWishlist(db, householdId, id)
}

/** Archive, not delete — the same soft-delete convention as rewards. */
export function archiveWishlist(db: Db, householdId: string, id: string) {
  requireList(db, householdId, id)
  db.update(wishlists).set({ archivedAt: new Date() }).where(eq(wishlists.id, id)).run()
  return { ok: true }
}

export function addItem(
  db: Db,
  householdId: string,
  listId: string,
  input: WishlistItemCreate,
  actorProfileId: string,
): WishlistItemDto {
  requireList(db, householdId, listId)
  const row = db.insert(wishlistItems).values({
    wishlistId: listId,
    name: input.name,
    url: input.url ?? null,
    notes: input.notes ?? null,
    price: input.price ?? null,
    priority: input.priority ?? 0,
    sortOrder: input.sortOrder ?? 0,
    createdByProfileId: actorProfileId,
  }).returning().get()
  return toItemDto(row)
}

function requireItem(db: Db, householdId: string, listId: string, itemId: string): ItemRow {
  requireList(db, householdId, listId)
  const row = db.select().from(wishlistItems)
    .where(and(eq(wishlistItems.id, itemId), eq(wishlistItems.wishlistId, listId)))
    .get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Item not found' })
  return row
}

export function updateItem(
  db: Db,
  householdId: string,
  listId: string,
  itemId: string,
  patch: Partial<WishlistItemCreate>,
): WishlistItemDto {
  requireItem(db, householdId, listId, itemId)
  db.update(wishlistItems).set({
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.url !== undefined && { url: patch.url ?? null }),
    ...(patch.notes !== undefined && { notes: patch.notes ?? null }),
    ...(patch.price !== undefined && { price: patch.price ?? null }),
    ...(patch.priority !== undefined && { priority: patch.priority }),
    ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
  }).where(eq(wishlistItems.id, itemId)).run()
  return toItemDto(db.select().from(wishlistItems).where(eq(wishlistItems.id, itemId)).get()!)
}

export function deleteItem(db: Db, householdId: string, listId: string, itemId: string) {
  requireItem(db, householdId, listId, itemId)
  db.delete(wishlistItems).where(eq(wishlistItems.id, itemId)).run()
  return { ok: true }
}
