import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { zHttpUrl } from '#shared/schemas/common'

/**
 * The ONE way this server makes an outbound request to a URL that a person
 * (or a document a person pointed us at) chose.
 *
 * Why this file exists — the board runs on a box inside a family's LAN, and
 * anyone who can add a recipe URL or a calendar feed can otherwise make that
 * box fetch things on their behalf. A plain `fetch(userUrl)` therefore reaches:
 *  - the router's admin page, the NAS, printers, cameras, home automation —
 *    all of which trust "requests from inside the LAN"
 *  - 169.254.169.254, the cloud metadata endpoint, when the household runs
 *    this on a VPS. That endpoint hands out credentials to anything that asks.
 *  - loopback: the board's own internal ports.
 * And with `redirect: 'follow'` none of that needs a private URL at all — a
 * perfectly public host can answer `302 Location: http://127.0.0.1/…`, so the
 * check has to happen on EVERY hop, not just the one the user typed.
 *
 * The second half of the job is size and time. An abort timer that is cleared
 * as soon as `fetch()` resolves only covers the headers; the body then streams
 * into memory with nothing armed, so a slow-loris or an endless response takes
 * out the single container the whole household shares. Here the budget is
 * started before the first connection and cleared only after the last byte is
 * read, and the body is counted as it streams rather than buffered first.
 *
 * Errors are deliberately vague to the caller: no resolved address, no
 * response body, and the same text for "blocked" and "unreachable". A member
 * who tries to map the LAN through this must not be able to tell a refusal
 * from a dead host, or a blind SSRF becomes a readable one. The specific
 * reason goes to the container log instead, where the admin can see it.
 *
 * KNOWN LIMIT: we validate the DNS answer and then let fetch() resolve the
 * name again, so a name that flips from public to private between the two
 * (DNS rebinding) is not fully closed — pinning the socket to the validated
 * address needs a custom undici dispatcher, which is not a dependency here.
 * The per-hop re-check, the size cap and the time budget bound the damage.
 */

export type SafeFetchReason
  = | 'scheme' // not http(s)
    | 'blocked' // resolved to a private/loopback/link-local address, or DNS failed
    | 'redirect' // too many hops, or a hop we couldn't parse
    | 'too-large' // body exceeded maxBytes
    | 'timeout' // exceeded the total budget
    | 'network' // connection failed

/** Client-safe messages. "blocked" and "network" MUST stay identical: telling
 *  them apart is exactly the oracle that turns a blind SSRF into a LAN scanner. */
const MESSAGES: Record<SafeFetchReason, string> = {
  scheme: 'Only http:// and https:// links can be fetched.',
  blocked: 'We couldn\'t reach that address.',
  redirect: 'That link redirected too many times.',
  'too-large': 'That response was too large to download.',
  timeout: 'That request took too long.',
  network: 'We couldn\'t reach that address.',
}

export class SafeFetchError extends Error {
  readonly reason: SafeFetchReason
  constructor(reason: SafeFetchReason) {
    super(MESSAGES[reason])
    this.name = 'SafeFetchError'
    this.reason = reason
  }
}

/**
 * Hostnames allowed to resolve to a private address, comma-separated, e.g.
 * `BETTS_ALLOW_PRIVATE_FETCH_HOSTS=nas.lan,192.168.1.10`.
 *
 * The escape hatch is an environment variable and NOT a setting in the UI on
 * purpose: subscribing to the ICS feed on your own NAS is a legitimate thing
 * for a household to want, but re-enabling LAN access has to cost a deliberate
 * edit to the compose file by whoever runs the box — not a checkbox that
 * anyone who reaches an admin session (or an admin who got phished) can flip.
 * Matching is exact and per-host, so opening the NAS does not open the router.
 */
function privateHostAllowlist(): Set<string> {
  return new Set(
    (process.env.BETTS_ALLOW_PRIVATE_FETCH_HOSTS ?? '')
      .split(',')
      .map(h => h.trim().toLowerCase().replace(/^\[|\]$/g, ''))
      .filter(Boolean),
  )
}

/**
 * IPv4 dotted-quad or IPv6 (incl. `::` compression and a trailing dotted-quad)
 * → raw bytes. Anything `node:net` won't vouch for comes back as null, and
 * callers treat null as private: a shape we can't read is not a shape we trust.
 */
function ipToBytes(ip: string): Uint8Array | null {
  const version = isIP(ip)
  if (version === 4) return Uint8Array.from(ip.split('.').map(Number))
  if (version !== 6) return null

  // Rewrite a trailing "::ffff:1.2.3.4" into pure hex groups so one loop does all.
  let text = ip
  const dotted = /:(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (dotted) {
    const v4 = ipToBytes(dotted[1]!)
    if (!v4) return null
    text = `${text.slice(0, dotted.index)}:${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`
  }

  const [head = '', tail] = text.split('::')
  const headGroups = head.split(':').filter(Boolean)
  const tailGroups = (tail ?? '').split(':').filter(Boolean)

  const bytes = new Uint8Array(16)
  let at = 0
  for (const g of headGroups) {
    const n = Number.parseInt(g, 16)
    bytes[at++] = n >> 8
    bytes[at++] = n & 0xFF
  }
  let end = 16
  for (const g of [...tailGroups].reverse()) {
    const n = Number.parseInt(g, 16)
    bytes[--end] = n & 0xFF
    bytes[--end] = n >> 8
  }
  return at <= end ? bytes : null
}

/**
 * True for anything that is not a public internet address.
 *
 * Exported so the test suite can assert the ranges directly — every entry
 * below is a place an attacker would like this server to knock on.
 */
export function isPrivateAddress(ip: string): boolean {
  const b = ipToBytes(ip)
  if (!b) return true // unparseable: refuse rather than guess

  if (b.length === 4) {
    const [a, second] = [b[0]!, b[1]!]
    if (a === 0) return true // 0.0.0.0/8 — "this network", routes to localhost on Linux
    if (a === 10) return true // 10/8 private
    if (a === 127) return true // 127/8 loopback
    if (a === 169 && second === 254) return true // 169.254/16 link-local, incl. 169.254.169.254 metadata
    if (a === 172 && second >= 16 && second <= 31) return true // 172.16/12 private
    if (a === 192 && second === 168) return true // 192.168/16 private
    if (a === 100 && second >= 64 && second <= 127) return true // 100.64/10 CGNAT
    if (a === 192 && second === 0) return true // 192.0.0/24 + 192.0.2/24 special use
    if (a === 198 && (second === 18 || second === 19)) return true // 198.18/15 benchmarking
    if (a >= 224) return true // multicast + reserved + 255.255.255.255
    return false
  }

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses
  // reach the same hosts as their v4 form, so judge them as v4.
  const v4Mapped = b.slice(0, 10).every(x => x === 0)
  if (v4Mapped && (b[10] === 0xFF && b[11] === 0xFF)) {
    return isPrivateAddress([...b.slice(12)].join('.'))
  }
  if (b.every(x => x === 0)) return true // ::
  if (b.slice(0, 15).every(x => x === 0) && b[15] === 1) return true // ::1 loopback
  if (v4Mapped && b[10] === 0 && b[11] === 0) return true // ::a.b.c.d (deprecated, ambiguous)
  if ((b[0]! & 0xFE) === 0xFC) return true // fc00::/7 unique-local
  if (b[0] === 0xFE && (b[1]! & 0xC0) === 0x80) return true // fe80::/10 link-local
  if (b[0] === 0xFF) return true // ff00::/8 multicast
  return false
}

/**
 * Resolve `hostname` and refuse unless EVERY address it answers with is
 * public. All of them, because fetch() picks whichever it likes (Happy
 * Eyeballs), so one private answer in the set is one private connection.
 */
async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (privateHostAllowlist().has(host)) return

  let addresses: string[]
  if (isIP(host)) {
    addresses = [host]
  }
  else {
    try {
      addresses = (await lookup(host, { all: true })).map(a => a.address)
    }
    catch {
      throw new SafeFetchError('blocked')
    }
  }

  if (!addresses.length || addresses.some(isPrivateAddress)) {
    console.warn(`[safeFetch] refused ${host}: resolves to a private address (set BETTS_ALLOW_PRIVATE_FETCH_HOSTS to allow it)`)
    throw new SafeFetchError('blocked')
  }
}

/** Parse + scheme-check one hop. Same rule as zHttpUrl, applied to redirects too. */
function parseHttpUrl(raw: string, base?: string): URL {
  if (!base && !zHttpUrl.safeParse(raw).success) throw new SafeFetchError('scheme')
  let url: URL
  try {
    url = new URL(raw, base)
  }
  catch {
    throw new SafeFetchError(base ? 'redirect' : 'scheme')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    // A redirect into file:// or data:// is a favourite way out of a scheme check.
    throw new SafeFetchError(base ? 'redirect' : 'scheme')
  }
  return url
}

export interface SafeFetchOptions {
  headers?: Record<string, string>
  /** Total budget covering DNS, connect, headers AND reading the body. */
  timeoutMs?: number
  /** Hard cap on the body; the stream is aborted the moment it is passed. */
  maxBytes?: number
  maxRedirects?: number
}

export interface SafeFetchResult {
  ok: boolean
  status: number
  contentType: string | null
  bytes: Uint8Array
  /** Final URL after all validated hops. */
  url: string
}

const DEFAULTS = {
  timeoutMs: 20_000,
  maxBytes: 5_000_000,
  // Recipe sites bounce through apex → www → https → consent/AMP variants;
  // 5 covers the real ones and still ends a redirect loop quickly.
  maxRedirects: 5,
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * Read the body with a hard cap, tearing the stream down instead of buffering
 * it. Exported because every outbound call in this app needs it, not only the
 * ones whose host is attacker-chosen: `res.json()` on a response that never
 * ends fills the one container the whole household shares, whatever timeout
 * the request was given.
 *
 * `onOverflow` lets a caller that owns an AbortController kill the connection
 * outright; without one we cancel the stream, which is enough on its own.
 */
export async function readCappedBody(
  res: Response,
  maxBytes: number,
  onOverflow?: () => void,
): Promise<Uint8Array> {
  const stop = () => {
    if (onOverflow) onOverflow()
    else void res.body?.cancel().catch(() => {})
  }

  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    stop() // don't spend a single byte on something already too big
    throw new SafeFetchError('too-large')
  }
  if (!res.body) return new Uint8Array()

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      // A liar in content-length, or a chunked stream with no end in sight.
      stop()
      throw new SafeFetchError('too-large')
    }
    chunks.push(value)
  }

  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

/**
 * Fetch a user-influenced URL with SSRF, size and time protection.
 * Throws {@link SafeFetchError} (client-safe message) on refusal; an HTTP
 * error status is NOT a throw — callers read `ok` / `status` themselves.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const { timeoutMs, maxBytes, maxRedirects } = { ...DEFAULTS, ...options }

  const controller = new AbortController()
  // Armed before the first connection and disarmed only after the last byte:
  // clearing it when fetch() resolves would leave the body read unprotected.
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let url = parseHttpUrl(rawUrl)

    for (let hop = 0; ; hop++) {
      await assertPublicHost(url.hostname)

      let res: Response
      try {
        res = await fetch(url, {
          headers: options.headers,
          // 'follow' would let a public host hand us 127.0.0.1 with no check.
          redirect: 'manual',
          signal: controller.signal,
          referrerPolicy: 'no-referrer',
        })
      }
      catch (err) {
        if (controller.signal.aborted) throw new SafeFetchError('timeout')
        if (err instanceof SafeFetchError) throw err
        throw new SafeFetchError('network')
      }

      if (!REDIRECT_STATUSES.has(res.status)) {
        const bytes = await readCappedBody(res, maxBytes, () => controller.abort())
        return {
          ok: res.ok,
          status: res.status,
          contentType: res.headers.get('content-type'),
          bytes,
          url: url.href,
        }
      }

      // Redirect: drop the body, then validate the next hop from scratch —
      // the same name can answer public now and private a second later.
      await res.body?.cancel().catch(() => {})
      const location = res.headers.get('location')
      if (!location || hop >= maxRedirects) throw new SafeFetchError('redirect')
      url = parseHttpUrl(location, url.href)
    }
  }
  catch (err) {
    if (err instanceof SafeFetchError) throw err
    if (controller.signal.aborted) throw new SafeFetchError('timeout')
    throw new SafeFetchError('network')
  }
  finally {
    clearTimeout(timer)
  }
}

/** {@link safeFetch}, decoded as UTF-8 text. */
export async function safeFetchText(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult & { text: string }> {
  const res = await safeFetch(rawUrl, options)
  return { ...res, text: new TextDecoder().decode(res.bytes) }
}
