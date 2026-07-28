import type { H3Event } from 'h3'
import { clientIp } from './clientIp'

/**
 * In-memory token bucket, keyed by caller. Good enough for a single-container
 * self-host; resets on restart by design.
 *
 * The Map is bounded on purpose. On a public route the key is derived from the
 * network peer, and a peer that can vary its key — by rotating source ports,
 * or by forging a header we were foolish enough to trust — would otherwise
 * grow this Map forever: an unauthenticated memory leak driven by the same
 * loop that brute-forces the password. Two bounds keep it flat: buckets that
 * have refilled to full are indistinguishable from absent ones and get swept,
 * and the total is hard-capped.
 */
const MAX_BUCKETS = 5_000
/** Drop to this on eviction so we don't re-scan on every subsequent insert. */
const EVICT_DOWN_TO = Math.floor(MAX_BUCKETS * 0.9)
const SWEEP_INTERVAL_MS = 60_000

interface Bucket {
  tokens: number
  refilledAt: number
  /** When this bucket would be back at maxTokens, i.e. when it stops mattering. */
  fullAt: number
}

const buckets = new Map<string, Bucket>()
let lastSweep = 0

export function checkRateLimit(key: string, maxTokens = 5, refillPerMinute = 1): boolean {
  const now = Date.now()
  sweep(now)

  const bucket = buckets.get(key) ?? { tokens: maxTokens, refilledAt: now, fullAt: now }
  const refill = ((now - bucket.refilledAt) / 60_000) * refillPerMinute
  bucket.tokens = Math.min(maxTokens, bucket.tokens + refill)
  bucket.refilledAt = now

  const allowed = bucket.tokens >= 1
  if (allowed) bucket.tokens -= 1

  bucket.fullAt = refillPerMinute > 0
    ? now + ((maxTokens - bucket.tokens) / refillPerMinute) * 60_000
    : Number.POSITIVE_INFINITY
  buckets.set(key, bucket)

  if (buckets.size > MAX_BUCKETS) evict()
  return allowed
}

/**
 * The only way to rate-limit an anonymous caller. Routes must never build an
 * IP-shaped key themselves — that is how the X-Forwarded-For bypass got in.
 * `prefix` namespaces the route, e.g. 'unlock'.
 */
export function checkIpRateLimit(event: H3Event, prefix: string, maxTokens = 5, refillPerMinute = 1): boolean {
  return checkRateLimit(`${prefix}:${clientIp(event)}`, maxTokens, refillPerMinute)
}

/** Exposed for tests and for anyone diagnosing memory growth. */
export function rateLimitBucketCount(): number {
  return buckets.size
}

/** A full bucket carries no information — a fresh one behaves identically. */
function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS && buckets.size <= MAX_BUCKETS) return
  lastSweep = now
  for (const [key, bucket] of buckets) {
    if (bucket.fullAt <= now) buckets.delete(key)
  }
}

/**
 * Evict the buckets closest to being full first. Evicting a throttled bucket
 * would hand its owner a free reset, which is exactly what an attacker
 * flooding this Map would be trying to buy.
 */
function evict() {
  const byLeastPenalised = [...buckets.entries()].sort((a, b) => a[1].fullAt - b[1].fullAt)
  for (const [key] of byLeastPenalised) {
    if (buckets.size <= EVICT_DOWN_TO) break
    buckets.delete(key)
  }
}
