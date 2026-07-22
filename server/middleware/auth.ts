import { getBoardSession } from '../utils/session'

// Session gate for /api/** and /uploads/**. Public: health, bootstrap,
// setup, unlock. The ICS export route (/feeds/:token.ics) authenticates by
// its secret token instead of a session.
const PUBLIC_API = new Set([
  '/api/health',
  '/api/bootstrap',
  '/api/setup',
  '/api/auth/unlock',
  '/api/auth/reset-password', // self-guards: only usable while the hash is cleared
])

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]!
  const guarded = path.startsWith('/api/') || path.startsWith('/uploads/')
  if (!guarded || PUBLIC_API.has(path)) return
  // @nuxt/icon serves bundled icon data here; needed on the unlock screen too.
  if (path.startsWith('/api/_nuxt_icon/')) return

  const session = await getBoardSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Locked' })
})
