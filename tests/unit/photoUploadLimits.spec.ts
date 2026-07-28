import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'

/**
 * The attack: POST /api/photos with a 2 GB body.
 *
 * The route buffers the whole multipart body via readMultipartFormData and
 * only then measures each file — so the 25 MB limit was enforced with the
 * memory already spent, and one request could OOM the container the whole
 * household runs on. These tests pin the guards that now run BEFORE the body
 * is read, and the batch limits that bound the work after it.
 */

// The route is a Nitro file; defineEventHandler is auto-imported there, and
// plain vitest has no such magic. Everything under test is a plain export.
;(globalThis as Record<string, unknown>).defineEventHandler = (handler: unknown) => handler

const {
  MAX_BODY_BYTES, MAX_FILES_PER_REQUEST, MAX_FILE_BYTES, assertUploadBatch, guardRequestBodySize,
} = await import('../../server/api/photos/index.post')

/** An http.IncomingMessage as the guard sees it: headers, 'data', destroy. */
class FakeRequest extends EventEmitter {
  destroyedWith: Error | null = null
  constructor(public headers: Record<string, string> = {}) {
    super()
  }

  destroy(error?: Error) {
    this.destroyedWith = error ?? new Error('destroyed')
    return this as never
  }
}

const guard = (req: FakeRequest, max?: number) =>
  guardRequestBodySize(req as never, max)

function imageFile(bytes: number, name = 'holiday.jpg'): { filename: string, type: string, data: Buffer } {
  // Buffer.alloc is lazy enough for the sizes here; nothing decodes it.
  return { filename: name, type: 'image/jpeg', data: Buffer.alloc(bytes) }
}

describe('guardRequestBodySize', () => {
  it('refuses an oversized upload from the headers, before a byte is buffered', () => {
    const req = new FakeRequest({ 'content-length': String(2 * 1024 * 1024 * 1024) })
    expect(() => guard(req)).toThrowError(expect.objectContaining({ statusCode: 413 }))
    // The proof that nothing will be read: no listener was ever attached, so
    // the body stays in the socket and is never concatenated into memory.
    expect(req.listenerCount('data')).toBe(0)
  })

  it('kills a body that understates or omits its length', () => {
    // Chunked uploads send no content-length at all, and a hostile client can
    // simply lie — so the bytes have to be counted as they land.
    const req = new FakeRequest({ 'content-length': '10' })
    guard(req, 1000)

    const chunk = Buffer.alloc(400)
    req.emit('data', chunk)
    req.emit('data', chunk)
    expect(req.destroyedWith).toBeNull() // 800 bytes: still inside the cap

    req.emit('data', chunk)
    expect(req.destroyedWith).toBeInstanceOf(Error) // 1200 bytes: cut off
  })

  it('counts string chunks by their byte length, not their character count', () => {
    const req = new FakeRequest({})
    guard(req, 10)
    req.emit('data', '€€€€') // 4 characters, 12 bytes
    expect(req.destroyedWith).toBeInstanceOf(Error)
  })

  it('lets a real phone photo through', () => {
    // A single 25 MB file plus multipart framing has to fit, or the cap has
    // quietly become a smaller per-file limit.
    expect(MAX_BODY_BYTES).toBeGreaterThan(MAX_FILE_BYTES)
    const req = new FakeRequest({ 'content-length': String(MAX_FILE_BYTES + 4096) })
    expect(() => guard(req)).not.toThrow()

    const legitimate = Buffer.alloc(1024 * 1024)
    for (let sent = 0; sent < MAX_FILE_BYTES; sent += legitimate.length) req.emit('data', legitimate)
    expect(req.destroyedWith).toBeNull()
  })
})

describe('assertUploadBatch', () => {
  it('refuses more files than one request may decode', () => {
    const batch = Array.from({ length: MAX_FILES_PER_REQUEST + 1 }, (_, i) => imageFile(1024, `p${i}.jpg`))
    expect(() => assertUploadBatch(batch)).toThrowError(expect.objectContaining({ statusCode: 413 }))
  })

  it('accepts a full batch at the limit', () => {
    const batch = Array.from({ length: MAX_FILES_PER_REQUEST }, (_, i) => imageFile(1024, `p${i}.jpg`))
    expect(() => assertUploadBatch(batch)).not.toThrow()
  })

  it('still refuses an oversized file and a non-image', () => {
    expect(() => assertUploadBatch([imageFile(MAX_FILE_BYTES + 1)]))
      .toThrowError(expect.objectContaining({ statusCode: 413 }))
    expect(() => assertUploadBatch([{ filename: 'payload.svg', type: 'image/svg+xml', data: Buffer.alloc(8) }]))
      .not.toThrow() // declared image/* — savePhoto is the one that decodes it
    expect(() => assertUploadBatch([{ filename: 'notes.txt', type: 'text/plain', data: Buffer.alloc(8) }]))
      .toThrowError(expect.objectContaining({ statusCode: 415 }))
  })

  it('refuses an empty batch', () => {
    expect(() => assertUploadBatch([])).toThrowError(expect.objectContaining({ statusCode: 400 }))
  })
})
