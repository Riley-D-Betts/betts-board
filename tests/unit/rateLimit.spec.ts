import type { H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkIpRateLimit, checkRateLimit, rateLimitBucketCount } from '../../server/utils/rateLimit'

/**
 * The attack these tests pin down: /api/auth/unlock is public, and the limiter
 * used to key its bucket on `getRequestIP(event, { xForwardedFor: true })`,
 * which returns the FIRST comma element of a header the client writes. Thirty
 * wrong passwords with a rotating forged header produced thirty 401s and no
 * 429s at all. If that ever comes back, the first test here fails.
 */

/** A request as h3 sees it: headers and the socket peer it actually connected from. */
function request(socketIp: string, forwardedFor?: string): H3Event {
  const headers: Record<string, string> = {}
  if (forwardedFor !== undefined) headers['x-forwarded-for'] = forwardedFor
  return {
    context: {},
    node: { req: { headers, socket: { remoteAddress: socketIp } } },
  } as unknown as H3Event
}

function countAllowed(events: H3Event[], prefix: string): number {
  return events.filter(event => checkIpRateLimit(event, prefix, 5, 1)).length
}

/** Stand in for the Nitro auto-import, which plain vitest does not provide. */
function withRuntimeConfig(trustedProxy: unknown, body: () => void) {
  const g = globalThis as Record<string, unknown>
  g.useRuntimeConfig = () => ({ trustedProxy })
  try {
    body()
  }
  finally {
    delete g.useRuntimeConfig
  }
}

afterEach(() => {
  vi.useRealTimers()
  delete process.env.BETTS_TRUSTED_PROXY
  delete (globalThis as Record<string, unknown>).useRuntimeConfig
})

describe('client keying', () => {
  it('ignores a forged X-Forwarded-For: one socket gets one bucket', () => {
    const attempts = Array.from({ length: 30 }, (_, i) =>
      request('198.51.100.7', `203.0.113.${i}`))

    expect(countAllowed(attempts, 'forged')).toBe(5)
  })

  it('gives the same allowance with no header at all', () => {
    const attempts = Array.from({ length: 30 }, () => request('198.51.100.8'))

    expect(countAllowed(attempts, 'bare')).toBe(5)
  })

  it('still ignores the header when the socket address is missing', () => {
    const noSocket = { context: {}, node: { req: { headers: { 'x-forwarded-for': '1.2.3.4' } } } } as unknown as H3Event
    const attempts = Array.from({ length: 30 }, () => noSocket)

    expect(countAllowed(attempts, 'nosocket')).toBe(5)
  })

  it('honours X-Forwarded-For only when the operator opted in, and reads the LAST element', () => {
    process.env.BETTS_TRUSTED_PROXY = '1'

    // The proxy appended the real peer; everything before it is attacker text.
    // Rotating that prefix must not buy a fresh bucket.
    const spoofed = Array.from({ length: 30 }, (_, i) =>
      request('10.0.0.2', `203.0.113.${i}, 198.51.100.20`))
    expect(countAllowed(spoofed, 'proxy')).toBe(5)

    // A genuinely different client behind the same proxy is a different bucket.
    const other = Array.from({ length: 30 }, () => request('10.0.0.2', 'evil, 198.51.100.21'))
    expect(countAllowed(other, 'proxy')).toBe(5)
  })

  it('treats an unset or falsy BETTS_TRUSTED_PROXY as untrusted', () => {
    process.env.BETTS_TRUSTED_PROXY = 'false'
    const attempts = Array.from({ length: 30 }, (_, i) =>
      request('198.51.100.9', `203.0.113.${i}, 198.51.100.${i}`))

    expect(countAllowed(attempts, 'falsy')).toBe(5)
  })

  /**
   * Nitro parses runtimeConfig env overrides through destr, so the operator who
   * sets NUXT_TRUSTED_PROXY=1 (or `trustedProxy: true` in nuxt.config) hands us
   * a number or a boolean, not the string the generated type promises. Calling a
   * string method on that threw straight out of the unlock handler: measured on
   * the real build, every single unlock returned 500, locking the family out of
   * the board entirely. Non-strings must be read, not thrown on.
   */
  it.each([['number 1', 1], ['boolean true', true], ['string "1"', '1']] as const)(
    'honours a %s runtimeConfig flag (destr coerces env overrides) instead of throwing',
    (label, value) => {
      withRuntimeConfig(value, () => {
        // Two clients behind the proxy, one socket. Trusting the header means
        // each gets its own bucket, so the socket yields 10 allowed in total;
        // ignoring it would cap the pair at 5 between them.
        const a = Array.from({ length: 30 }, (_, i) => request('10.0.0.3', `203.0.113.${i}, 198.51.100.30`))
        const b = Array.from({ length: 30 }, (_, i) => request('10.0.0.3', `203.0.113.${i}, 198.51.100.31`))
        expect(countAllowed(a, label)).toBe(5)
        expect(countAllowed(b, label)).toBe(5)
      })
    },
  )

  it.each([['number 0', 0], ['boolean false', false], ['empty string', ''], ['absent', undefined]] as const)(
    'treats a %s runtimeConfig flag as untrusted, without throwing',
    (label, value) => {
      withRuntimeConfig(value, () => {
        // Rotating the LAST element too: still one socket, so still one bucket.
        const attempts = Array.from({ length: 30 }, (_, i) =>
          request('10.0.0.4', `203.0.113.${i}, 198.51.100.4${i}`))
        expect(countAllowed(attempts, label)).toBe(5)
      })
    },
  )
})

describe('bucket store bounds', () => {
  it('does not grow without limit when the key varies every call', () => {
    for (let i = 0; i < 20_000; i++) checkRateLimit(`flood:${i}`, 5, 1)

    // The exact cap is an implementation detail; unbounded growth is the bug.
    expect(rateLimitBucketCount()).toBeLessThanOrEqual(5_000)
  })

  it('keeps throttled buckets and drops refilled ones', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.now()

    for (let i = 0; i < 5; i++) checkRateLimit('sweep:victim', 5, 1)
    expect(checkRateLimit('sweep:victim', 5, 1)).toBe(false)

    // Ten minutes on, the bucket has refilled and carries no information.
    vi.setSystemTime(start + 10 * 60_000)
    checkRateLimit('sweep:other', 5, 1)
    expect(rateLimitBucketCount()).toBe(1)
    expect(checkRateLimit('sweep:victim', 5, 1)).toBe(true)
  })
})
