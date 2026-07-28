import type { H3Event } from 'h3'
import { getRequestHeader, getRequestIP } from 'h3'

/**
 * Who is this request from, for rate-limiting and lockout purposes?
 *
 * NEVER reach for `getRequestIP(event, { xForwardedFor: true })` instead. h3
 * returns the FIRST comma element of X-Forwarded-For, and every element except
 * the one the nearest proxy appended is written by the client. A limiter keyed
 * on that is no limiter at all: measured against this build, 30 wrong
 * passwords with a rotating forged header gave 30x401 and zero 429s, while the
 * same 30 without the header gave 5x401 then 25x429.
 *
 * So the socket address — the one address the client cannot choose — wins by
 * default, and the header is consulted only when the operator has told us a
 * reverse proxy really is in front (BETTS_TRUSTED_PROXY). Even then we take the
 * LAST element: nginx's `proxy_add_x_forwarded_for` and friends APPEND the peer
 * they actually saw, so the tail is the only element the client could not
 * forge. (That assumes exactly one trusted hop. With two chained proxies the
 * tail is the inner proxy's own address — coarse, but never attacker-chosen,
 * which is the property that matters here.)
 */
export function clientIp(event: H3Event): string {
  if (trustsProxyHeader()) {
    const forwarded = getRequestHeader(event, 'x-forwarded-for')
    const nearest = forwarded?.split(',').map(part => part.trim()).filter(Boolean).at(-1)
    if (nearest) return nearest
  }
  try {
    // No xForwardedFor option: this resolves the socket peer address only.
    return getRequestIP(event) || 'unknown'
  }
  catch {
    // Some adapters hand us an event with no socket. Falling back to a single
    // shared bucket is stricter than per-caller, never looser.
    return 'unknown'
  }
}

/**
 * Opt-in, and read at request time rather than build time so one image works
 * both bare on the LAN and behind a proxy. Read the same way as BETTS_DATA_DIR:
 * env var first, runtime config second (useRuntimeConfig only exists inside
 * Nitro, hence the catch).
 *
 * The value is coerced with String() rather than trusted to be one. Nitro parses
 * runtimeConfig env overrides through destr, so `NUXT_TRUSTED_PROXY=1` arrives
 * as the NUMBER 1 and `=true` as the BOOLEAN true, whatever the generated type
 * says. Calling .trim() on those threw a TypeError that the try/catch above does
 * not cover, and an unhandled throw here 500s /api/auth/unlock — the only way
 * into the board. Measured on the real build: every unlock returned 500.
 */
function trustsProxyHeader(): boolean {
  let fromConfig: unknown
  try {
    fromConfig = useRuntimeConfig().trustedProxy
  }
  catch {
    fromConfig = undefined
  }
  const raw = String(process.env.BETTS_TRUSTED_PROXY || fromConfig || '').trim()
  return /^(1|true|yes|on)$/i.test(raw)
}
