import { isIP } from 'node:net'
import { createError } from 'h3'
import { parseDecimalToMinor, secondsToDate } from '#shared/utils/money'
import { readCappedBody } from '../../utils/safeFetch'
import { redactCredentials, sanitizeErrorList, sanitizeUpstreamMessage } from './redact'

/**
 * SimpleFIN Bridge client (protocol 2.0.0-draft).
 *
 * The flow: the user pastes a base64 **setup token**, which decodes to a claim
 * URL. We POST to it once and get back an **Access URL** with inline basic-auth
 * credentials. The token is single-use and is never stored; the access URL is
 * stored encrypted (server/utils/crypto.ts).
 *
 * SSRF is the part the SimpleFIN spec does not cover, because the spec is
 * written from the client's point of view. Here the *server* fetches a URL that
 * came out of a user-supplied token — on a home LAN that is "make my box POST
 * to http://192.168.1.1/setup.cgi" handed to whoever pastes it, including a kid
 * who was talked into pasting something. So:
 *   - https only (http only for an explicitly allowlisted host, for a
 *     self-hosted bridge on the LAN)
 *   - the host must be in the allowlist, read once at module load
 *   - redirects are refused outright rather than followed
 *   - IP-literal hosts in private, loopback, or link-local ranges are refused
 *   - TLS verification is Node's default and is never touched
 */

// Both of SimpleFIN's public bridge hosts. Real setup tokens issued today
// decode to a claim URL on `beta-bridge.simplefin.org` — that is the live
// bridge the README links people to — so leaving it out of the default made
// every out-of-the-box connection fail the host check before it ever left the
// box. `bridge.simplefin.org` stays in for anyone whose token points there.
export const DEFAULT_HOSTS = 'bridge.simplefin.org,beta-bridge.simplefin.org'
/** Comma-separated. The test stub sets 127.0.0.1; self-hosters add their own bridge. */
const ALLOWED_HOSTS = new Set(
  (process.env.BETTS_SIMPLEFIN_HOSTS || DEFAULT_HOSTS)
    .split(',').map(h => h.trim().toLowerCase()).filter(Boolean),
)
/** Bank aggregation is genuinely slow; 10s would false-fail on real accounts.
 *  This is a TOTAL budget — it covers reading the body, not just the headers. */
const FETCH_TIMEOUT_MS = 20_000
/** 90 days across several institutions is a few MB of JSON at most. */
const MAX_RESPONSE_BYTES = 10_000_000
/** SimpleFIN only guarantees a window of history — don't ask for the world. */
export const INITIAL_HISTORY_DAYS = 90
/** Re-fetch overlap, so amended and late-posting transactions are picked up. */
export const SYNC_OVERLAP_DAYS = 5

export class SimpleFinReauthError extends Error {
  readonly needsReauth = true
}

function assertFetchableUrl(raw: string, what: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: `${what} is not a valid URL` })
  }

  const host = url.hostname.toLowerCase()
  const allowed = ALLOWED_HOSTS.has(host)
  if (!allowed) {
    throw createError({
      statusCode: 400,
      statusMessage: `${what} points at ${host}, which is not an allowed SimpleFIN host`,
    })
  }
  // http is tolerated only for a host someone explicitly allowlisted — that is
  // the self-hosted-bridge-on-the-LAN case, and it is their decision to make.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowed)) {
    throw createError({ statusCode: 400, statusMessage: `${what} must use https` })
  }
  if (isPrivateAddress(host) && !allowed) {
    throw createError({ statusCode: 400, statusMessage: `${what} points at a private address` })
  }
  return url
}

/** Blocks IP literals only; a hostname that resolves privately is caught by the allowlist. */
function isPrivateAddress(host: string): boolean {
  const stripped = host.startsWith('[') ? host.slice(1, -1) : host
  const version = isIP(stripped)
  if (version === 4) {
    const [a = 0, b = 0] = stripped.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }
  if (version === 6) {
    const lower = stripped.toLowerCase()
    return lower === '::1' || lower === '::' || lower.startsWith('fe80:')
      || lower.startsWith('fc') || lower.startsWith('fd')
  }
  return false
}

/**
 * SimpleFIN URLs carry inline basic-auth credentials, and WHATWG `fetch`
 * refuses to construct a Request from a URL that has any ("Request cannot be
 * constructed from a URL that includes credentials"). So the userinfo is
 * lifted out into an Authorization header and the URL sent clean — which is
 * also what keeps the credentials out of redirect targets and error strings.
 */
function splitCredentials(url: URL): { url: URL, authorization?: string } {
  if (!url.username && !url.password) return { url }
  const user = decodeURIComponent(url.username)
  const pass = decodeURIComponent(url.password)
  const clean = new URL(url.href)
  clean.username = ''
  clean.password = ''
  return {
    url: clean,
    authorization: `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`,
  }
}

/**
 * One request, read to completion here rather than handing a live `Response`
 * back to the caller.
 *
 * The timeout is `AbortSignal.timeout` and not a `setTimeout` cleared once
 * `fetch()` resolves. That older shape disarmed itself the instant the HEADERS
 * arrived, so `res.json()` afterwards ran with nothing armed: a bridge that
 * sends headers and then dribbles forever streamed straight into the memory of
 * the single container this household runs, past any nominal timeout. The
 * signal now covers the body, and `readCappedBody` stops the stream at the cap
 * instead of buffering everything and checking the size afterwards.
 */
async function simplefinFetch(
  target: URL,
  init: { method?: string } = {},
): Promise<{ ok: boolean, status: number, text: string }> {
  const { url, authorization } = splitCredentials(target)
  let res: Response
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        'User-Agent': 'betts-board',
        'Accept': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      // Never follow a redirect: it would be a second, unvalidated hop.
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  }
  catch {
    // Deliberately opaque: the underlying message can contain the access URL.
    throw createError({ statusCode: 502, statusMessage: 'Could not reach SimpleFIN' })
  }

  let bytes: Uint8Array
  try {
    bytes = await readCappedBody(res, MAX_RESPONSE_BYTES)
  }
  catch {
    // Same opaque text — a body-read failure must not describe the target either.
    throw createError({ statusCode: 502, statusMessage: 'Could not reach SimpleFIN' })
  }
  return { ok: res.ok, status: res.status, text: new TextDecoder().decode(bytes) }
}

/**
 * Exchanges a setup token for an access URL. Single-use by design — a 403 here
 * usually means the token was already claimed, and the user needs to know that
 * could mean someone else claimed it.
 */
export async function claimSetupToken(setupToken: string): Promise<string> {
  let decoded: string
  try {
    decoded = Buffer.from(setupToken.trim(), 'base64').toString('utf8').trim()
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'That does not look like a SimpleFIN setup token' })
  }
  if (!decoded.startsWith('http')) {
    throw createError({ statusCode: 400, statusMessage: 'That does not look like a SimpleFIN setup token' })
  }

  const claimUrl = assertFetchableUrl(decoded, 'The setup token')
  const res = await simplefinFetch(claimUrl, { method: 'POST' })

  if (res.status === 403) {
    throw createError({
      statusCode: 502,
      statusMessage: 'That setup token was rejected. It is single-use, so it may already have been claimed — '
        + 'possibly by someone else. Sign in to SimpleFIN, revoke it, and create a new one.',
    })
  }
  if (!res.ok) {
    throw createError({ statusCode: 502, statusMessage: `SimpleFIN rejected the setup token (HTTP ${res.status})` })
  }

  const accessUrl = res.text.trim()
  // Validate the URL we were handed with the same rules as the token's.
  assertFetchableUrl(accessUrl, 'The access URL SimpleFIN returned')
  return accessUrl
}

export interface SimpleFinTransaction {
  id: string
  postedAt: Date
  amountMinor: number
  description: string
  payee: string | null
  memo: string | null
  pending: boolean
}

export interface SimpleFinAccount {
  externalId: string
  orgName: string | null
  name: string
  currency: string
  balanceMinor: number
  availableBalanceMinor: number | null
  balanceAt: Date | null
  transactions: SimpleFinTransaction[]
}

export interface SimpleFinResult {
  accounts: SimpleFinAccount[]
  /** Per-institution failures. Sanitised; partial success is the normal case. */
  errors: string[]
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Positive epoch seconds, or null. `posted: 0` is the spec's "not posted yet". */
function epochSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Normalises one raw account. Amounts arrive as decimal STRINGS and timestamps
 * as epoch SECONDS — both are easy to get wrong and neither failure is loud
 * (a ×1000 error puts everything in 1970; a parseFloat loses a cent a month).
 */
function normalizeAccount(raw: Record<string, unknown>): SimpleFinAccount | null {
  const externalId = str(raw.id)
  if (!externalId) return null

  // The spec permits a URL here for non-ISO assets. Anything that isn't three
  // letters is stored verbatim and treated as opaque rather than crashing.
  const currency = str(raw.currency) ?? 'USD'
  const org = raw.org as Record<string, unknown> | undefined
  const balanceRaw = str(raw.balance)
  const availableRaw = str(raw['available-balance'])
  const balanceDate = typeof raw['balance-date'] === 'number' ? raw['balance-date'] : null

  const transactions: SimpleFinTransaction[] = []
  for (const t of Array.isArray(raw.transactions) ? raw.transactions : []) {
    const txn = t as Record<string, unknown>
    const id = str(txn.id)
    const amountRaw = str(txn.amount)
    const pending = txn.pending === true
    // A pending transaction has not posted, so the spec sends `posted: 0`
    // (some bridges omit the field) and carries the real date in
    // `transacted_at`. Requiring a non-zero `posted` therefore threw away
    // every pending row the `pending=1` request went to the trouble of
    // fetching — and accepting the literal 0 was worse: a row dated
    // 1970-01-01, sorted to the bottom of history where nobody scrolls, and
    // outside the window the stale-pending sweep is allowed to delete from.
    // Date it by transacted_at, or by "now" as a last resort — a hold that
    // just appeared in the feed happened about now, and the reconcile pass
    // rewrites the date with the bank's real one the moment it settles.
    const posted = epochSeconds(txn.posted) ?? epochSeconds(txn.transacted_at)
      ?? (pending ? Math.floor(Date.now() / 1000) : null)
    if (!id || !amountRaw || posted == null) continue
    try {
      transactions.push({
        id,
        postedAt: secondsToDate(posted),
        amountMinor: parseDecimalToMinor(amountRaw, currency),
        description: str(txn.description) ?? '(no description)',
        payee: str(txn.payee),
        memo: str(txn.memo),
        pending,
      })
    }
    catch {
      // One unparseable amount must not lose the other 200 rows.
      continue
    }
  }

  let balanceMinor = 0
  try {
    balanceMinor = balanceRaw ? parseDecimalToMinor(balanceRaw, currency) : 0
  }
  catch { /* leave at 0 and let balanceAt stay null — better than a wrong number */ }

  let availableBalanceMinor: number | null = null
  try {
    availableBalanceMinor = availableRaw ? parseDecimalToMinor(availableRaw, currency) : null
  }
  catch { /* optional field */ }

  return {
    externalId,
    orgName: str(org?.name) ?? str(org?.domain),
    name: str(raw.name) ?? 'Account',
    currency,
    balanceMinor,
    availableBalanceMinor,
    balanceAt: balanceDate != null ? secondsToDate(balanceDate) : null,
    transactions,
  }
}

/**
 * Fetches accounts and transactions.
 *
 * A 200 with a non-empty `errlist` is the NORMAL case when a household has
 * several institutions and one is having a bad day — so everything in
 * `accounts` is always ingested, and the errors are reported alongside rather
 * than instead.
 */
export async function fetchAccounts(accessUrl: string, opts: { startDate?: Date } = {}): Promise<SimpleFinResult> {
  const base = assertFetchableUrl(accessUrl, 'The stored access URL')
  const url = new URL(`${base.href.replace(/\/$/, '')}/accounts`)
  if (opts.startDate) {
    url.searchParams.set('start-date', String(Math.floor(opts.startDate.getTime() / 1000)))
  }
  // Without this SimpleFIN returns POSTED transactions only, so a card payment
  // made this morning — still a pending hold at the bank — simply is not in the
  // response, and re-syncing all day never surfaces it. Everything downstream
  // was already built for pending rows: the column, the "Pending" badge, their
  // exclusion from budgets and the forecast, and the sweep that drops a hold the
  // bank later cancels. This request was the one place that never asked.
  url.searchParams.set('pending', '1')

  const res = await simplefinFetch(url)
  if (res.status === 403) {
    throw new SimpleFinReauthError('SimpleFIN rejected the stored credentials — reconnect this bank')
  }
  if (!res.ok) {
    throw createError({ statusCode: 502, statusMessage: `SimpleFIN returned HTTP ${res.status}` })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(res.text) as Record<string, unknown>
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: 'SimpleFIN returned a response we could not read' })
  }

  const accounts = (Array.isArray(payload.accounts) ? payload.accounts : [])
    .map(a => normalizeAccount(a as Record<string, unknown>))
    .filter((a): a is SimpleFinAccount => a !== null)

  return { accounts, errors: sanitizeErrorList(payload.errlist) }
}

/** Turns any thrown value into something safe to store and show. */
export function describeSyncError(error: unknown): string {
  if (error instanceof SimpleFinReauthError) return error.message
  const message = (error as { statusMessage?: string, message?: string })?.statusMessage
    ?? (error as { message?: string })?.message
    ?? 'Sync failed'
  return sanitizeUpstreamMessage(String(message))
}

/** Exported for the connection-status UI, which shows the host but never the credentials. */
export function describeAccessUrl(accessUrl: string): string {
  return redactCredentials(accessUrl)
}
