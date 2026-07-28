import { createReadStream, existsSync, statSync } from 'node:fs'
import { lookup } from 'mrmime'
import { uploadsDir } from '../../utils/dataDir'
import { resolveWithin } from '../../utils/safePath'

// Streams files from $DATA_DIR/uploads. The global auth middleware already
// gates /uploads/** behind an unlocked session.
export default defineEventHandler((event) => {
  const rel = getRouterParam(event, 'path') ?? ''
  // resolveWithin, not startsWith: see server/utils/safePath.ts — a prefix test
  // would also serve a sibling directory such as $DATA_DIR/uploads-evil.
  const full = resolveWithin(uploadsDir(), rel)
  if (!full) throw createError({ statusCode: 400, statusMessage: 'Bad path' })
  if (!existsSync(full) || !statSync(full).isFile()) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  setHeader(event, 'Content-Type', lookup(full) ?? 'application/octet-stream')
  setHeader(event, 'Cache-Control', 'private, max-age=31536000, immutable')
  return sendStream(event, createReadStream(full))
})
