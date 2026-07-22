import { useDb } from '../db/client'
import { verifyBearerToken } from '../services/apiKeys/keys'
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

  // Public API: "Authorization: Bearer bb_…" authenticates instead of the
  // session cookie. The resolved session rides the event context.
  const authHeader = getHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const apiSession = verifyBearerToken(useDb(), authHeader.slice(7).trim())
    if (!apiSession) throw createError({ statusCode: 401, statusMessage: 'Invalid API key' })
    event.context.boardApiSession = apiSession
    return
  }

  const session = await getBoardSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Locked' })
})
