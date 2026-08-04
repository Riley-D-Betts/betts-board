import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installNitroGlobals } from '../support/nitroGlobals'

installNitroGlobals()

// ── Stub SimpleFIN bridge ────────────────────────────────────────────────
// simplefin.ts reads BETTS_SIMPLEFIN_HOSTS once at module load, so the env var
// must be set before the module is imported — hence the dynamic import in
// beforeAll, the same ordering the feedback spec needs.

type SimpleFin = typeof import('../../server/services/finance/simplefin')
let claimSetupToken: SimpleFin['claimSetupToken']
let fetchAccounts: SimpleFin['fetchAccounts']
let SimpleFinReauthError: SimpleFin['SimpleFinReauthError']
let DEFAULT_HOSTS: SimpleFin['DEFAULT_HOSTS']

let stub: Server
let base: string
let calls: { method: string, url: string, auth: string | undefined }[]
/**
 * Per-test behaviour: a response, 'destroy' for a network failure, or
 * 'endless' — headers arrive immediately and the body never stops. 'endless'
 * is the shape that used to walk straight past this client's timeout, because
 * the abort timer was cleared the moment fetch() resolved.
 */
let respond: (url: string) => { status: number, body: string, headers?: Record<string, string> } | 'destroy' | 'endless'

beforeAll(async () => {
  stub = createServer((req, res) => {
    calls.push({ method: req.method!, url: req.url!, auth: req.headers.authorization })
    const result = respond(req.url!)
    if (result === 'destroy') return req.destroy()
    if (result === 'endless') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      const pump = () => {
        if (res.writableEnded || res.destroyed) return
        if (res.write('x'.repeat(64 * 1024))) setTimeout(pump, 1)
        else res.once('drain', pump)
      }
      return pump()
    }
    res.writeHead(result.status, { 'Content-Type': 'application/json', ...result.headers })
    res.end(result.body)
  })
  await new Promise<void>(resolve => stub.listen(0, '127.0.0.1', resolve))

  process.env.BETTS_SIMPLEFIN_HOSTS = '127.0.0.1'
  base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`
  ;({ claimSetupToken, fetchAccounts, SimpleFinReauthError, DEFAULT_HOSTS } = await import('../../server/services/finance/simplefin'))
})

afterAll(async () => {
  delete process.env.BETTS_SIMPLEFIN_HOSTS
  // The 'endless' case deliberately leaves a socket mid-response; without this
  // the close() below waits on it forever.
  stub.closeAllConnections()
  await new Promise<void>(resolve => stub.close(() => resolve()))
})

beforeEach(() => {
  calls = []
  respond = () => ({ status: 200, body: '{}' })
})

const token = (url: string) => Buffer.from(url, 'utf8').toString('base64')
const ACCESS = (port: number) => `http://someuser:somepass@127.0.0.1:${port}/simplefin`

describe('the default host allowlist', () => {
  it('trusts both of SimpleFIN’s public bridges out of the box', () => {
    // beta-bridge is where real setup tokens actually point — and where the
    // README sends people — so leaving it out made every default install
    // reject a valid token at the host check before the request ever left.
    const hosts = DEFAULT_HOSTS.split(',').map(h => h.trim())
    expect(hosts).toContain('bridge.simplefin.org')
    expect(hosts).toContain('beta-bridge.simplefin.org')
  })
})

describe('claimSetupToken', () => {
  it('POSTs to the decoded claim URL and returns the access URL', async () => {
    const port = (stub.address() as AddressInfo).port
    respond = () => ({ status: 200, body: ACCESS(port) })

    const accessUrl = await claimSetupToken(token(`${base}/claim/abc`))
    expect(accessUrl).toBe(ACCESS(port))
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/claim/abc' })
  })

  it('tells the user a 403 may mean the token was intercepted', async () => {
    respond = () => ({ status: 403, body: 'no' })
    await expect(claimSetupToken(token(`${base}/claim/abc`))).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: expect.stringContaining('revoke'),
    })
  })

  it.each([
    ['a non-allowlisted host', 'https://bridge.evil.test/claim'],
    ['the router on the LAN', 'http://192.168.1.1/setup.cgi'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['loopback by another name', 'http://[::1]:8080/claim'],
    ['a file URL', 'file:///etc/passwd'],
  ])('refuses to fetch %s', async (_label, url) => {
    await expect(claimSetupToken(token(url))).rejects.toMatchObject({ statusCode: 400 })
    expect(calls).toHaveLength(0)
  })

  it('refuses a token that is not a URL at all', async () => {
    await expect(claimSetupToken(token('hello'))).rejects.toMatchObject({ statusCode: 400 })
    await expect(claimSetupToken('not base64 !!!')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('validates the access URL the bridge hands back, not just the token', async () => {
    respond = () => ({ status: 200, body: 'https://bridge.evil.test/simplefin' })
    await expect(claimSetupToken(token(`${base}/claim/abc`))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses to follow a redirect', async () => {
    respond = () => ({ status: 302, body: '', headers: { Location: `${base}/elsewhere` } })
    await expect(claimSetupToken(token(`${base}/claim/abc`))).rejects.toMatchObject({
      statusMessage: 'Could not reach SimpleFIN',
    })
  })

  it('reports a dropped connection without leaking the URL', async () => {
    respond = () => 'destroy'
    await expect(claimSetupToken(token(`${base}/claim/abc`))).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: 'Could not reach SimpleFIN',
    })
  })
})

// A payload shaped like the spec's own example.
function payload(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    errors: [],
    accounts: [{
      org: { domain: 'mybank.com', name: 'My Bank' },
      id: 'ACT-123',
      name: 'Checking',
      currency: 'USD',
      'balance': '-33293.43',
      'available-balance': '-33911.99',
      'balance-date': 978366153, // epoch SECONDS — Jan 2001
      'transactions': [
        { id: 'TRN-1', posted: 978366153, amount: '-33.53', description: 'Uncle Frank’s Bait Shop' },
        // A pending transaction has not posted: the spec sends posted: 0 and
        // puts the real date in transacted_at. The fixture mirrors that —
        // giving it a filled-in posted here once hid a bug that dropped every
        // real pending row.
        { id: 'TRN-2', posted: 0, transacted_at: 978366153, amount: '1200.00', description: 'PAYROLL', pending: true },
      ],
    }],
    ...over,
  })
}

async function fetchPayload(over: Record<string, unknown> = {}) {
  respond = () => ({ status: 200, body: payload(over) })
  const port = (stub.address() as AddressInfo).port
  return fetchAccounts(ACCESS(port))
}

describe('fetchAccounts', () => {
  it('parses balances and amounts as exact minor units', async () => {
    respond = () => ({ status: 200, body: payload() })
    const port = (stub.address() as AddressInfo).port
    const result = await fetchAccounts(ACCESS(port))

    const account = result.accounts[0]!
    expect(account.balanceMinor).toBe(-3329343)
    expect(account.availableBalanceMinor).toBe(-3391199)
    expect(account.orgName).toBe('My Bank')
    expect(account.transactions[0]!.amountMinor).toBe(-3353)
    expect(account.transactions[1]!.pending).toBe(true)
  })

  /**
   * SimpleFIN returns POSTED transactions only unless asked otherwise. Without
   * `pending=1` a card payment made this morning — still a hold at the bank —
   * is absent from the response entirely, and re-syncing never surfaces it.
   * Everything downstream already handles pending rows; this request is the
   * only place that has to ask for them.
   */
  it('asks for pending transactions, or today never shows up', async () => {
    respond = () => ({ status: 200, body: payload() })
    const port = (stub.address() as AddressInfo).port
    await fetchAccounts(ACCESS(port))

    const asked = new URL(`http://x${calls.at(-1)!.url}`)
    expect(asked.searchParams.get('pending')).toBe('1')
  })

  it('still sends start-date alongside it', async () => {
    respond = () => ({ status: 200, body: payload() })
    const port = (stub.address() as AddressInfo).port
    await fetchAccounts(ACCESS(port), { startDate: new Date('2026-07-01T00:00:00Z') })

    const asked = new URL(`http://x${calls.at(-1)!.url}`)
    expect(asked.searchParams.get('start-date')).toBe(String(Math.floor(Date.UTC(2026, 6, 1) / 1000)))
    expect(asked.searchParams.get('pending')).toBe('1')
  })

  it('treats posted and balance-date as seconds, not milliseconds', async () => {
    respond = () => ({ status: 200, body: payload() })
    const port = (stub.address() as AddressInfo).port
    const { accounts } = await fetchAccounts(ACCESS(port))
    expect(accounts[0]!.balanceAt!.getUTCFullYear()).toBe(2001)
    expect(accounts[0]!.transactions[0]!.postedAt.getUTCFullYear()).toBe(2001)
  })

  it('sends start-date as epoch seconds', async () => {
    respond = () => ({ status: 200, body: payload() })
    const port = (stub.address() as AddressInfo).port
    await fetchAccounts(ACCESS(port), { startDate: new Date('2026-01-01T00:00:00Z') })
    const url = new URL(`http://x${calls[0]!.url}`)
    expect(url.searchParams.get('start-date')).toBe('1767225600')
  })

  it('ingests accounts even when errlist is non-empty — partial is normal', async () => {
    respond = () => ({ status: 200, body: payload({ errlist: ['Chase needs re-authentication'] }) })
    const port = (stub.address() as AddressInfo).port
    const result = await fetchAccounts(ACCESS(port))
    expect(result.accounts).toHaveLength(1)
    expect(result.errors).toEqual(['Chase needs re-authentication'])
  })

  it('sanitises a hostile errlist', async () => {
    respond = () => ({
      status: 200,
      body: payload({
        errlist: [
          `control\u0000chars\u001bhere\nand   spaces`,
          'x'.repeat(5000),
          `leaked https://user:hunter2@bridge.simplefin.org/simplefin here`,
          ...Array.from({ length: 40 }, (_, i) => `extra ${i}`),
        ],
      }),
    })
    const port = (stub.address() as AddressInfo).port
    const { errors } = await fetchAccounts(ACCESS(port))

    expect(errors).toHaveLength(10)
    expect(errors[0]).toBe('control chars here and spaces')
    expect(errors[1]!.length).toBeLessThanOrEqual(300)
    expect(errors[2]).toContain('***:***@')
    expect(errors[2]).not.toContain('hunter2')
  })

  it('raises a distinct re-auth error on 403 so backoff can be a day, not minutes', async () => {
    respond = () => ({ status: 403, body: 'no' })
    const port = (stub.address() as AddressInfo).port
    await expect(fetchAccounts(ACCESS(port))).rejects.toBeInstanceOf(SimpleFinReauthError)
  })

  /**
   * The reason `pending=1` alone didn't fix "this morning's payment never
   * shows up": a pending transaction has `posted: 0` (or no `posted` at all)
   * and carries its date in `transacted_at`. The normaliser used to require a
   * non-zero `posted`, so it either dropped the row outright or dated it
   * 1970-01-01 — the bottom of a list sorted by date, where nobody scrolls.
   */
  it('keeps a pending transaction whose date lives in transacted_at, not posted', async () => {
    const { accounts } = await fetchPayload({
      accounts: [{
        id: 'ACT-1',
        name: 'Checking',
        currency: 'USD',
        balance: '10.00',
        transactions: [
          { id: 'P-0', posted: 0, transacted_at: 1785000000, amount: '-12.50', description: 'CARD HOLD', pending: true },
          { id: 'P-omitted', transacted_at: 1785000000, amount: '-4.00', description: 'COFFEE', pending: true },
        ],
      }],
    })
    const txns = accounts[0]!.transactions
    expect(txns.map(t => t.id)).toEqual(['P-0', 'P-omitted'])
    expect(txns[0]!.pending).toBe(true)
    expect(txns[0]!.postedAt.getTime()).toBe(1785000000_000)
    expect(txns[1]!.postedAt.getTime()).toBe(1785000000_000)
  })

  it('dates a pending transaction with no timestamp at all as now, never 1970', async () => {
    const { accounts } = await fetchPayload({
      accounts: [{
        id: 'ACT-1',
        name: 'Checking',
        currency: 'USD',
        balance: '10.00',
        transactions: [
          { id: 'P-bare', posted: 0, amount: '-9.99', description: 'AUTH', pending: true },
        ],
      }],
    })
    const txn = accounts[0]!.transactions[0]!
    expect(Math.abs(txn.postedAt.getTime() - Date.now())).toBeLessThan(60_000)
  })

  it('still skips a POSTED transaction that has no usable date', async () => {
    const { accounts } = await fetchPayload({
      accounts: [{
        id: 'ACT-1',
        name: 'Checking',
        currency: 'USD',
        balance: '10.00',
        transactions: [
          { id: 'X', posted: 0, amount: '-1.00', description: 'no date, not pending' },
          { id: 'OK', posted: 978366153, amount: '-2.00', description: 'fine' },
        ],
      }],
    })
    expect(accounts[0]!.transactions.map(t => t.id)).toEqual(['OK'])
  })

  it('skips an unparseable amount rather than losing the whole account', async () => {
    respond = () => ({
      status: 200,
      body: payload({
        accounts: [{
          id: 'ACT-1',
          name: 'Checking',
          currency: 'USD',
          balance: '10.00',
          transactions: [
            { id: 'A', posted: 978366153, amount: '1,234.00', description: 'bad' },
            { id: 'B', posted: 978366153, amount: '5.00', description: 'good' },
          ],
        }],
      }),
    })
    const port = (stub.address() as AddressInfo).port
    const { accounts } = await fetchAccounts(ACCESS(port))
    expect(accounts[0]!.transactions.map(t => t.id)).toEqual(['B'])
  })

  /**
   * The spec says balances and amounts are decimal strings, but bridges exist
   * that send raw JSON numbers. `str()` used to reject those, and a rejected
   * balance quietly became "the balance is 0" — written over the stored one on
   * every sync. "It syncs transactions but not account values" was this.
   */
  it('accepts a balance and amount sent as JSON numbers, not strings', async () => {
    const { accounts } = await fetchPayload({
      accounts: [{
        id: 'ACT-1',
        name: 'Checking',
        currency: 'USD',
        'balance': 1234.56,
        'available-balance': 1200,
        'transactions': [
          { id: 'N', posted: 978366153, amount: -33.53, description: 'numeric amount' },
        ],
      }],
    })
    expect(accounts[0]!.balanceMinor).toBe(123456)
    expect(accounts[0]!.availableBalanceMinor).toBe(120000)
    expect(accounts[0]!.transactions[0]!.amountMinor).toBe(-3353)
  })

  it('reports a missing or unparseable balance as null, never 0', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { accounts } = await fetchPayload({
      accounts: [
        { id: 'NOBAL', name: 'No balance', currency: 'USD', transactions: [] },
        { id: 'BADBAL', name: 'Bad balance', currency: 'USD', balance: 'N/A', transactions: [] },
      ],
    })
    expect(accounts.map(a => a.balanceMinor)).toEqual([null, null])
    // The unparseable one (not the merely absent one) warns even without the
    // debug flag — a bridge mangling balances should not be silent.
    expect(warn.mock.calls.flat().join('\n')).toContain('BADBAL')
    warn.mockRestore()
  })

  it('handles a zero-decimal currency without inflating the balance', async () => {
    respond = () => ({
      status: 200,
      body: payload({
        accounts: [{ id: 'JP', name: 'Yen', currency: 'JPY', balance: '1000', transactions: [] }],
      }),
    })
    const port = (stub.address() as AddressInfo).port
    const { accounts } = await fetchAccounts(ACCESS(port))
    expect(accounts[0]!.balanceMinor).toBe(1000)
  })

  it('keeps a non-ISO currency verbatim instead of crashing', async () => {
    respond = () => ({
      status: 200,
      body: payload({
        accounts: [{
          id: 'BTC', name: 'Wallet', currency: 'https://bitcoin.org', balance: '0.50', transactions: [],
        }],
      }),
    })
    const port = (stub.address() as AddressInfo).port
    const { accounts } = await fetchAccounts(ACCESS(port))
    expect(accounts[0]!.currency).toBe('https://bitcoin.org')
  })

  it('sends the credentials as a header, never in the URL', async () => {
    // WHATWG fetch refuses to build a Request from a URL containing
    // credentials — and every SimpleFIN access URL contains them. Getting this
    // wrong means literally every sync fails, so it is pinned here.
    respond = () => ({ status: 200, body: payload() })
    const port = (stub.address() as AddressInfo).port
    await fetchAccounts(ACCESS(port))

    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from('someuser:somepass').toString('base64')}`)
    expect(calls[0]!.url).not.toContain('someuser')
    expect(calls[0]!.url).not.toContain('somepass')
  })

  it('never puts the access URL into a thrown message', async () => {
    respond = () => 'destroy'
    const port = (stub.address() as AddressInfo).port
    await expect(fetchAccounts(ACCESS(port))).rejects.toSatisfy((error: Error) => {
      const text = JSON.stringify(error, Object.getOwnPropertyNames(error))
      return !text.includes('somepass') && !text.includes('someuser')
    })
  })

  // A bridge that sends headers and then never stops used to walk right past
  // the request timeout, because the abort timer was cleared as soon as
  // fetch() resolved and res.json() then ran with nothing armed. Reverting to
  // a live Response + res.json() makes this test buffer until it times out.
  it('stops an endless response body instead of buffering it', async () => {
    respond = () => 'endless'
    const port = (stub.address() as AddressInfo).port
    const started = Date.now()

    await expect(fetchAccounts(ACCESS(port))).rejects.toMatchObject({ statusCode: 502 })

    expect(Date.now() - started).toBeLessThan(15_000) // well inside the 20s budget
  }, 20_000)

  it('refuses a body whose declared length is over the cap', async () => {
    respond = () => ({ status: 200, body: 'short', headers: { 'Content-Length': '999999999' } })
    const port = (stub.address() as AddressInfo).port
    await expect(fetchAccounts(ACCESS(port))).rejects.toMatchObject({ statusCode: 502 })
  })
})

describe('BETTS_SIMPLEFIN_DEBUG', () => {
  beforeEach(() => {
    // An inherited flag from the runner's environment would flip the
    // flag-off test; every test in here states its own.
    delete process.env.BETTS_SIMPLEFIN_DEBUG
  })
  afterEach(() => {
    delete process.env.BETTS_SIMPLEFIN_DEBUG
    vi.restoreAllMocks()
  })

  it('logs the request URL and the raw response body when enabled', async () => {
    process.env.BETTS_SIMPLEFIN_DEBUG = '1'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await fetchPayload()

    const lines = log.mock.calls.map(args => args.join(' '))
    expect(lines.some(l => l.includes('request: GET') && l.includes('/simplefin/accounts'))).toBe(true)
    expect(lines.some(l => l.includes('response body') && l.includes('Uncle Frank'))).toBe(true)
    // The per-account summary shows what the normaliser made of the payload.
    expect(lines.some(l => l.includes('ACT-123') && l.includes('balance'))).toBe(true)
  })

  /**
   * The debug flag exists to be turned on and its output pasted into an issue.
   * So the strongest requirement is negative: no line it produces may contain
   * the basic-auth credentials — not the request URL (which carries them until
   * the fetch strips them), not a response body whose errlist quotes the
   * credentialed URL, and not the claim response (which IS the access URL).
   */
  it('never leaks credentials into the debug log', async () => {
    process.env.BETTS_SIMPLEFIN_DEBUG = '1'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const port = (stub.address() as AddressInfo).port

    respond = () => ({ status: 200, body: payload({ errlist: [`upstream said ${ACCESS(port)} failed`] }) })
    await fetchAccounts(ACCESS(port))
    respond = () => ({ status: 200, body: ACCESS(port) })
    await claimSetupToken(token(`${base}/claim/abc`))

    const text = log.mock.calls.flat().join('\n')
    expect(text).toContain('[simplefin]') // the flag actually logged something
    expect(text).not.toContain('someuser')
    expect(text).not.toContain('somepass')
  })

  it('is silent when the flag is off', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await fetchPayload()
    expect(log.mock.calls.flat().join('\n')).not.toContain('[simplefin]')
  })

  it('never logs the claim token — the secret lives in the URL PATH', async () => {
    // A claim URL is https://…/claim/<single-use token>. Credential redaction
    // scrubs user:pass@ userinfo and cannot see a path, so the only safe log
    // line is one that never contains the path — especially on a FAILED
    // claim, which leaves the logged token alive and claimable by whoever
    // reads the pasted log.
    process.env.BETTS_SIMPLEFIN_DEBUG = '1'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    respond = () => 'destroy' // the failed-claim case is the dangerous one
    await expect(claimSetupToken(token(`${base}/claim/SECRET-TOKEN-XYZ`))).rejects.toBeTruthy()

    const text = log.mock.calls.flat().join('\n')
    expect(text).toContain('claim') // the request WAS logged…
    expect(text).not.toContain('SECRET-TOKEN-XYZ') // …without its secret
  })

  it('redacts a credentialed URL even when the JSON escapes its slashes', async () => {
    // PHP's json_encode escapes "/" by default, so a bridge error string can
    // quote the access URL as https:\/\/user:pass@host — which a redaction
    // regex demanding a literal :// would sail right past.
    process.env.BETTS_SIMPLEFIN_DEBUG = '1'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const port = (stub.address() as AddressInfo).port
    const escaped = payload({ errlist: [`upstream said ${ACCESS(port)} failed`] }).replace(/\//g, '\\/')
    respond = () => ({ status: 200, body: escaped })
    await fetchAccounts(ACCESS(port))

    const text = log.mock.calls.flat().join('\n')
    expect(text).not.toContain('someuser')
    expect(text).not.toContain('somepass')
  })

  it('strips control characters a hostile bridge could use to forge log lines', async () => {
    process.env.BETTS_SIMPLEFIN_DEBUG = '1'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await fetchPayload({
      accounts: [{
        id: 'EVIL-1',
        name: 'Checking\u001b[2J\n[simplefin] forged line',
        currency: 'USD',
        balance: '10.00',
        transactions: [],
      }],
    })

    const lines = log.mock.calls.map(args => args.join(' '))
    expect(lines.join('')).not.toContain('\u001b')
    // The newline was stripped, so the forged text rides INSIDE a real line
    // rather than standing alone as its own.
    expect(lines.some(l => l.startsWith('[simplefin] forged line'))).toBe(false)
  })

  it('redacts before truncating, so a credential straddling the cap never half-leaks', async () => {
    process.env.BETTS_SIMPLEFIN_DEBUG = '1'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const port = (stub.address() as AddressInfo).port
    // Pad so the credentialed URL sits across the 200k boundary; truncating
    // first would end the log with an unredacted "https://someuser:somepa".
    respond = () => ({
      status: 200,
      body: payload({ errlist: [`${'x'.repeat(200_010)} see ${ACCESS(port)} there`] }),
    })
    await fetchAccounts(ACCESS(port))

    const text = log.mock.calls.flat().join('\n')
    expect(text).toContain('[truncated')
    expect(text).not.toContain('someuser')
    expect(text).not.toContain('somepa')
  })
})
