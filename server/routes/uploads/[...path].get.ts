import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { lookup } from 'mrmime'
import { uploadsDir } from '../../utils/dataDir'

// Streams files from $DATA_DIR/uploads. The global auth middleware already
// gates /uploads/** behind an unlocked session.
export default defineEventHandler((event) => {
  const rel = getRouterParam(event, 'path') ?? ''
  const root = uploadsDir()
  const full = normalize(join(root, rel))
  if (!full.startsWith(root)) throw createError({ statusCode: 400, statusMessage: 'Bad path' })
  if (!existsSync(full) || !statSync(full).isFile()) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  setHeader(event, 'Content-Type', lookup(full) ?? 'application/octet-stream')
  setHeader(event, 'Cache-Control', 'private, max-age=31536000, immutable')
  return sendStream(event, createReadStream(full))
})
