// In-memory token bucket, keyed by IP. Good enough for a single-container
// self-host; resets on restart by design.
const buckets = new Map<string, { tokens: number, refilledAt: number }>()

export function checkRateLimit(key: string, maxTokens = 5, refillPerMinute = 1): boolean {
  const now = Date.now()
  const bucket = buckets.get(key) ?? { tokens: maxTokens, refilledAt: now }
  const refill = ((now - bucket.refilledAt) / 60_000) * refillPerMinute
  bucket.tokens = Math.min(maxTokens, bucket.tokens + refill)
  bucket.refilledAt = now
  if (bucket.tokens < 1) {
    buckets.set(key, bucket)
    return false
  }
  bucket.tokens -= 1
  buckets.set(key, bucket)
  return true
}
