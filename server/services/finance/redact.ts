/**
 * A SimpleFIN Access URL embeds live basic-auth credentials for the family's
 * bank data: `https://<user>:<pass>@bridge.simplefin.org/simplefin`. It can end
 * up inside fetch error messages, upstream error bodies, and stack traces — all
 * of which flow into `lastError`, which is displayed on screen and could be
 * pasted into a GitHub feedback issue. So it gets scrubbed at every boundary.
 */

/** `https://user:pass@host/…` → `https://***:***@host/…`, anywhere in a string. */
export function redactCredentials(input: string): string {
  // The userinfo part of a URL cannot contain '/', '@', or whitespace, so this
  // stops at the real authority rather than eating a later '@' in a path.
  //
  // `(?:\\?\/){2}` also matches the JSON-escaped spelling `https:\/\/…` — some
  // serializers (PHP's json_encode, notably) escape forward slashes by
  // default, and a credentialed URL quoted inside such a body would otherwise
  // sail past a regex that insists on a literal `://`.
  return input.replace(
    /\b([a-z][a-z0-9+.-]*:(?:\\?\/){2})([^/@\s]+)@/gi,
    (_match, scheme: string) => `${scheme}***:***@`,
  )
}

/**
 * Upstream text is untrusted: SimpleFIN's `errlist` is written by whoever runs
 * the bridge and relays whatever the bank said. Vue escapes on render, but the
 * control characters and the length cap are ours to enforce — a 5 KB error
 * string wrecks a phone layout, and C0/C1 characters wreck a log file.
 */
export function sanitizeUpstreamMessage(input: string, maxLength = 300): string {
  const cleaned = redactCredentials(input)
    // eslint-disable-next-line no-control-regex -- stripping them is the point
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned
}

const MAX_ERRLIST_ENTRIES = 10

export function sanitizeErrorList(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((e): e is string => typeof e === 'string')
    .slice(0, MAX_ERRLIST_ENTRIES)
    .map(e => sanitizeUpstreamMessage(e))
    .filter(Boolean)
}
