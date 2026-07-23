import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import type { OutputInfo, Sharp } from 'sharp'
import { createError } from 'h3'
import { and, desc, eq, lt } from 'drizzle-orm'
import type { PhotoDto } from '#shared/schemas/photos'
import type { Db } from '../../db/client'
import { photos } from '../../db/schema'
import { uploadsDir } from '../../utils/dataDir'

const MAIN_MAX_PX = 2560
const MAIN_QUALITY = 82
const THUMB_MAX_PX = 480
const THUMB_QUALITY = 75

/**
 * Pull DateTimeOriginal out of a raw EXIF blob without a full TIFF parser:
 * EXIF datetimes are stored as the ASCII string "YYYY:MM:DD HH:MM:SS", so a
 * scan for that pattern finds it. Returns null on any doubt — a photo without
 * a taken-at date is still a photo.
 */
export function parseExifTakenAt(exif: Buffer | Uint8Array | undefined): Date | null {
  if (!exif || exif.length === 0) return null
  const ascii = Buffer.from(exif).toString('latin1')
  const m = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(ascii)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  if (y! < 1900 || y! > 2200 || mo! < 1 || mo! > 12 || d! < 1 || d! > 31) return null
  if (h! > 23 || mi! > 59 || s! > 60) return null
  const date = new Date(y!, mo! - 1, d!, h!, mi!, s!) // EXIF has no timezone; treat as local wall time
  return Number.isNaN(date.getTime()) ? null : date
}

export interface SavePhotoArgs {
  householdId: string
  profileId: string | null
  buffer: Buffer
  originalName?: string
}

const HEIF_BRANDS = new Set([
  'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', // HEVC-coded
  'mif1', 'msf1', // generic HEIF
  'avif', 'avis',
])

/** ISO-BMFF ftyp major-brand sniff: HEIF-family container (iPhone/Samsung HEIC, AVIF). */
export function isHeifContainer(buffer: Buffer | Uint8Array): boolean {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  return buf.length >= 12
    && buf.toString('latin1', 4, 8) === 'ftyp'
    && HEIF_BRANDS.has(buf.toString('latin1', 8, 12))
}

function unreadableError(originalName?: string) {
  return createError({
    statusCode: 415,
    statusMessage: `${originalName ?? 'That file'} doesn't look like an image we can read`,
  })
}

async function encodeVariants(make: () => Sharp) {
  const main = await make()
    .rotate() // bake in EXIF orientation
    .resize({ width: MAIN_MAX_PX, height: MAIN_MAX_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: MAIN_QUALITY })
    .toBuffer({ resolveWithObject: true })
  const thumb = await make()
    .rotate()
    .resize({ width: THUMB_MAX_PX, height: THUMB_MAX_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY })
    .toBuffer()
  return { main, thumb }
}

/**
 * sharp pipeline: honor EXIF orientation, re-encode a bounded main jpeg and a
 * thumbnail, then insert the photos row. Throws 415 when the buffer isn't a
 * decodable image.
 */
export async function savePhoto(db: Db, args: SavePhotoArgs) {
  let main: { data: Buffer, info: OutputInfo }
  let thumb: Buffer
  let takenAt: Date | null
  try {
    const meta = await sharp(args.buffer).metadata()
    takenAt = parseExifTakenAt(meta.exif)
    ;({ main, thumb } = await encodeVariants(() => sharp(args.buffer)))
  }
  catch {
    // Prebuilt sharp parses HEIF containers but ships no HEVC codec, so phone
    // HEIC photos fail only at decode time. Decode those in WASM and feed the
    // raw pixels back through the same pipeline. libheif applies the
    // container's orientation transforms during decode.
    if (!isHeifContainer(args.buffer)) throw unreadableError(args.originalName)
    try {
      const { default: decodeHeic } = await import('heic-decode')
      const { width, height, data } = await decodeHeic({ buffer: args.buffer })
      const raw = Buffer.from(data)
      ;({ main, thumb } = await encodeVariants(() =>
        sharp(raw, { raw: { width, height, channels: 4 } })))
      // No sharp metadata on raw pixels; the EXIF datetime scan works on the
      // whole container just as well.
      takenAt = parseExifTakenAt(args.buffer)
    }
    catch {
      throw unreadableError(args.originalName)
    }
  }

  const filename = `${randomUUID()}.jpg`
  writeFileSync(join(uploadsDir('photos'), filename), main.data)
  writeFileSync(join(uploadsDir('photos', 'thumbs'), filename), thumb)

  return db.insert(photos).values({
    householdId: args.householdId,
    uploadedByProfileId: args.profileId,
    path: `photos/${filename}`,
    thumbPath: `photos/thumbs/${filename}`,
    width: main.info.width,
    height: main.info.height,
    sizeBytes: main.data.length,
    takenAt,
    inSlideshow: true,
  }).returning().get()
}

export interface ListPhotosArgs {
  householdId: string
  cursor?: string // last photo id of the previous page
  limit: number
}

/** Newest first. IDs are UUIDv7 (time-ordered), so keyset pagination on id works. */
export function listPhotos(db: Db, args: ListPhotosArgs) {
  return db.select().from(photos)
    .where(and(
      eq(photos.householdId, args.householdId),
      args.cursor ? lt(photos.id, args.cursor) : undefined,
    ))
    .orderBy(desc(photos.id))
    .limit(args.limit)
    .all()
}

export function getPhoto(db: Db, householdId: string, id: string) {
  return db.select().from(photos)
    .where(and(eq(photos.id, id), eq(photos.householdId, householdId)))
    .get() ?? null
}

export function setInSlideshow(db: Db, householdId: string, id: string, inSlideshow: boolean) {
  const updated = db.update(photos)
    .set({ inSlideshow })
    .where(and(eq(photos.id, id), eq(photos.householdId, householdId)))
    .returning()
    .get()
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Photo not found' })
  return updated
}

/** Removes both files (best-effort) and the row. */
export function deletePhoto(db: Db, householdId: string, id: string) {
  const row = getPhoto(db, householdId, id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Photo not found' })
  for (const rel of [row.path, row.thumbPath]) {
    try {
      rmSync(join(uploadsDir(), rel), { force: true })
    }
    catch { /* row removal matters more than a stray file */ }
  }
  db.delete(photos).where(eq(photos.id, id)).run()
  return { ok: true }
}

/** All slideshow-enabled photos for a household (unshuffled). */
export function listSlideshowPhotos(db: Db, householdId: string) {
  return db.select().from(photos)
    .where(and(eq(photos.householdId, householdId), eq(photos.inSlideshow, true)))
    .all()
}

export function toPhotoDto(row: typeof photos.$inferSelect): PhotoDto {
  return {
    id: row.id,
    url: `/uploads/${row.path}`,
    thumbUrl: `/uploads/${row.thumbPath}`,
    width: row.width,
    height: row.height,
    takenAt: row.takenAt ? row.takenAt.getTime() : null,
    uploadedAt: row.uploadedAt.getTime(),
    inSlideshow: row.inSlideshow,
    uploadedByProfileId: row.uploadedByProfileId,
  }
}

/** Fisher–Yates; returns a new array. */
export function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}
