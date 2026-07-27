import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

let stub: Server
let base: string
let calls: { method: string, url: string, auth: string | undefined }[]
/** Per-test behaviour: a response, or 'destroy' for a network failure. */
let respond: (url: string) => { status: number, body: string, headers?: Record<string, string> } | 'destroy'

beforeAll(async () => {
  stub = createServer((req, res) => {
    calls.push({ method: req.method!, url: req.url!, auth: req.headers.authorization })
    const result = respond(req.url!)
    if (result === 'destroy') return req.destroy()
    res.writeHead(result.status, { 'Content-Type': 'application/json', ...result.headers })
    res.end(result.body)
  })
  await new Promise<void>(resolve => stub.listen(0, '127.0.0.1', resolve))

  process.env.BETTS_SIMPLEFIN_HOSTS = '127.0.0.1'
  base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`
  ;({ claimSetupToken, fetchAccounts, SimpleFinReauthError } = await import('../../server/services/finance/simplefin'))
})

afterAll(async () => {
  delete process.env.BETTS_SIMPLEFIN_HOSTS
  await new Promise<void>(resolve => stub.close(() => resolve()))
})

beforeEach(() => {
  calls = []
  respond = () => ({ status: 200, body: '{}' })
})

const token = (url: string) => Buffer.from(url, 'utf8').toString('base64')
const ACCESS = (port: number) => `http://someuser:somepass@127.0.0.1:${port}/simplefin`

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
        { id: 'TRN-2', posted: 978366153, amount: '1200.00', description: 'PAYROLL', pending: true },
      ],
    }],
    ...over,
  })
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
})
