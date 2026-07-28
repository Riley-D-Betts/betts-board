import { createReadStream, existsSync, statSync } from 'node:fs'
import { fontsDir } from '../../utils/dataDir'
import { resolveWithin } from '../../utils/safePath'

// Streams downloaded webfonts from $DATA_DIR/fonts.
//
// Intentionally NOT session-gated: the global auth middleware guards /api/**
// and /uploads/**, and the household's font has to render on the lock screen,
// where there is no session yet. Font files carry nothing sensitive.
const ALLOWED = /^[a-z0-9-]+\/(?:\d+\.woff2|font\.css)$/

export default defineEventHandler((event) => {
  const rel = getRouterParam(event, 'path') ?? ''
  if (!ALLOWED.test(rel)) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  // Belt and braces behind ALLOWED: resolveWithin, not startsWith — see
  // server/utils/safePath.ts. A prefix test would also serve a sibling
  // directory such as $DATA_DIR/fonts-evil, and this route is ungated.
  const full = resolveWithin(fontsDir(), rel)
  if (!full) throw createError({ statusCode: 400, statusMessage: 'Bad path' })
  if (!existsSync(full) || !statSync(full).isFile()) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  setHeader(event, 'Content-Type', rel.endsWith('.css') ? 'text/css; charset=utf-8' : 'font/woff2')
  // Content is immutable per version; the settings record cache-busts with ?v=.
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  return sendStream(event, createReadStream(full))
})
