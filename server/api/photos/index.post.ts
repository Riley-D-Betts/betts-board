import type { IncomingMessage } from 'node:http'
import { createError } from 'h3'
import type { PhotoDto } from '#shared/schemas/photos'
import { useDb } from '../../db/client'
import { savePhoto, toPhotoDto } from '../../services/photos/store'
import { requireHousehold, requireProfile } from '../../utils/session'

export const MAX_FILE_BYTES = 25 * 1024 * 1024

/** Phones hand over whole albums at once; more than this is a batch, not a moment. */
export const MAX_FILES_PER_REQUEST = 20

/**
 * Ceiling on the whole multipart body.
 *
 * `readMultipartFormData` buffers the entire request in memory before anything
 * can look at it, so a per-file limit checked afterwards is checked with the
 * memory already spent — a 2 GB POST from any unlocked profile (or anyone at
 * all, if the household exposed the board to the internet) takes the single
 * container down. The cap has to fit one 25 MB photo plus multipart framing,
 * and comfortably fits a dozen phone photos; a bigger album gets a 413 asking
 * for fewer at a time, which costs a re-pick instead of the whole board.
 */
export const MAX_BODY_BYTES = 64 * 1024 * 1024

/** What the size guard needs from a Node request. */
export type GuardableRequest = Pick<IncomingMessage, 'headers' | 'on' | 'destroy'>

const mb = (bytes: number) => Math.floor(bytes / 1024 / 1024)

/**
 * Refuse an oversized body BEFORE a byte of it is buffered.
 *
 * Two halves, because neither is sufficient alone:
 *  - Content-Length is what an honest client sends, and rejecting on it means
 *    the upload is refused during the request headers.
 *  - It is a claim, though: it can be understated, and chunked bodies omit it
 *    entirely. So the bytes are counted as they arrive and the socket is
 *    destroyed the moment the cap is passed, which is the only thing that
 *    actually bounds memory. Destroying is deliberate — a body that is still
 *    arriving cannot be answered politely without accepting all of it first.
 *
 * Must be called before anything reads the body: this counts the same 'data'
 * events h3 buffers from, so attaching after h3 would count nothing.
 */
export function guardRequestBodySize(req: GuardableRequest, maxBytes = MAX_BODY_BYTES): void {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: `Upload is larger than ${mb(maxBytes)} MB — send fewer photos at a time`,
    })
  }

  let seen = 0
  req.on('data', (chunk: Buffer | string) => {
    seen += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    if (seen > maxBytes) req.destroy(new Error(`request body exceeded ${maxBytes} bytes`))
  })
}

// Some OS/browser combos send no MIME type for HEIC files — fall back to the
// extension. savePhoto still 415s anything that doesn't actually decode.
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i

/** One uploaded part, as h3's multipart parser hands it over. */
export interface UploadedFile {
  filename?: string
  type?: string
  data: Buffer
}

/**
 * Everything the batch must satisfy before a single file is written to disk or
 * handed to sharp. Count first: decoding is the expensive part, so the number
 * of decodes a request can trigger has to be bounded too, not just the bytes.
 */
export function assertUploadBatch(files: UploadedFile[]): void {
  if (files.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No files uploaded' })
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    throw createError({
      statusCode: 413,
      statusMessage: `Upload at most ${MAX_FILES_PER_REQUEST} photos at a time`,
    })
  }
  for (const f of files) {
    if (f.data.length > MAX_FILE_BYTES) {
      throw createError({
        statusCode: 413,
        statusMessage: `${f.filename} is larger than ${mb(MAX_FILE_BYTES)} MB`,
      })
    }
    if (!f.type?.startsWith('image/') && !IMAGE_EXT.test(f.filename ?? '')) {
      throw createError({ statusCode: 415, statusMessage: `${f.filename} is not an image` })
    }
  }
}

export default defineEventHandler(async (event): Promise<PhotoDto[]> => {
  const { profile } = await requireProfile(event)
  const hh = requireHousehold()

  guardRequestBodySize(event.node.req)

  const parts = await readMultipartFormData(event)
  const files = (parts ?? []).filter(p => p.filename && p.data.length > 0)

  // Validate the whole batch before writing anything.
  assertUploadBatch(files)

  const saved: PhotoDto[] = []
  for (const f of files) {
    saved.push(toPhotoDto(await savePhoto(useDb(), {
      householdId: hh.id,
      profileId: profile.id,
      buffer: f.data,
      originalName: f.filename,
    })))
  }
  return saved
})
