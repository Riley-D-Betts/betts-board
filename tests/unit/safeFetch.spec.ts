import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { createDb, type Db } from '../../server/db/client'
import { calendarFeeds, defaultHouseholdSettings, events, households } from '../../server/db/schema'
import { SafeFetchError, isPrivateAddress, safeFetch, safeFetchText } from '../../server/utils/safeFetch'
import { refreshFeed } from '../../server/services/ics/import'
import { importRecipeFromUrl } from '../../server/services/recipes/fetch'

/**
 * These tests run the attacks, not the fix. Every one of them passes today and
 * fails the moment someone puts a bare fetch() back on a user-supplied URL:
 *
 *  - the server below IS the router admin page / NAS / metadata endpoint. It
 *    lives on loopback and hands out "SECRET", and nothing the app does may
 *    ever return that string or even cause a request to reach it.
 *  - /slow and /endless are the unbounded-download half: a response whose
 *    headers arrive instantly and whose body never ends. An abort timer that
 *    is cleared when fetch() resolves does not stop either of them, so if
 *    these tests hang, the regression is exactly the one they guard.
 */

const SECRET = 'SECRET-INTERNAL-DATA'

let server: Server
let port: number
/** Requests that actually reached the "internal" service. Must stay at 0. */
let hits: string[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    hits.push(url.pathname)
    switch (url.pathname) {
      case '/secret':
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(SECRET)
        return
      case '/redirect-to-loopback':
        // A public host answering "go look at the LAN for me" — the shape that
        // makes redirect: 'follow' an SSRF all by itself.
        res.writeHead(302, { location: `http://localhost:${port}/secret` })
        res.end()
        return
      case '/redirect-to-file':
        res.writeHead(302, { location: 'file:///etc/passwd' })
        res.end()
        return
      case '/redirect-loop':
        res.writeHead(302, { location: `http://127.0.0.1:${port}/redirect-loop` })
        res.end()
        return
      case '/slow':
        // Headers now, body never. The old timer was already disarmed here.
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.write('start')
        return
      case '/endless': {
        res.writeHead(200, { 'content-type': 'text/plain' })
        const pump = () => {
          if (res.writableEnded) return
          if (res.write('x'.repeat(64 * 1024))) setTimeout(pump, 1)
          else res.once('drain', pump)
        }
        pump()
        return
      }
      case '/lying-length':
        res.writeHead(200, { 'content-length': '999999999' })
        res.end('short')
        return
      case '/recipe':
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(`<html><head><script type="application/ld+json">
          {"@type":"Recipe","name":"Pwned","recipeIngredient":["${SECRET}"],"recipeInstructions":["x"]}
        </script></head><body></body></html>`)
        return
      case '/feed.ics':
        res.writeHead(200, { 'content-type': 'text/calendar' })
        res.end([
          'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:leak@x',
          `SUMMARY:${SECRET}`, 'DTSTART:20260101T100000Z', 'DTEND:20260101T110000Z',
          'END:VEVENT', 'END:VCALENDAR',
        ].join('\r\n'))
        return
      default:
        res.writeHead(404)
        res.end()
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(() => {
  server.closeAllConnections()
  server.close()
})

beforeEach(() => {
  hits = []
  delete process.env.BETTS_ALLOW_PRIVATE_FETCH_HOSTS
})

afterEach(() => {
  delete process.env.BETTS_ALLOW_PRIVATE_FETCH_HOSTS
})

/** Opt in to loopback the way a household opts in to its own NAS. */
function allowLoopback() {
  process.env.BETTS_ALLOW_PRIVATE_FETCH_HOSTS = '127.0.0.1'
}

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'no-error'
  }
  catch (err) {
    return err instanceof SafeFetchError ? err.reason : `other: ${String(err)}`
  }
}

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.99.1.2', 'the rest of 127/8'],
    ['10.0.0.5', '10/8'],
    ['172.16.0.1', 'bottom of 172.16/12'],
    ['172.31.255.254', 'top of 172.16/12'],
    ['192.168.1.1', 'the home router'],
    ['169.254.169.254', 'cloud metadata'],
    ['0.0.0.0', '0/8'],
    ['100.64.0.1', 'CGNAT'],
    ['255.255.255.255', 'broadcast'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['fc00::1', 'unique-local'],
    ['fd12:3456::1', 'unique-local'],
    ['fe80::1', 'IPv6 link-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
    ['not-an-ip', 'unparseable'],
  ])('refuses %s (%s)', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  it.each([
    ['8.8.8.8', 'public resolver'],
    ['1.1.1.1', 'public resolver'],
    ['93.184.216.34', 'a normal website'],
    ['172.15.0.1', 'just below 172.16/12'],
    ['172.32.0.1', 'just above 172.16/12'],
    ['192.167.1.1', 'just below 192.168/16'],
    ['2606:4700:4700::1111', 'public IPv6'],
  ])('allows %s (%s)', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false)
  })
})

describe('safeFetch scheme handling', () => {
  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'gopher://127.0.0.1:11211/',
    'ftp://example.test/x',
    'not a url',
  ])('refuses %s', async (url) => {
    expect(await reasonOf(safeFetch(url))).toBe('scheme')
  })
})

describe('safeFetch address blocking', () => {
  it('refuses a loopback URL and never reaches the service', async () => {
    expect(await reasonOf(safeFetch(`http://127.0.0.1:${port}/secret`))).toBe('blocked')
    expect(hits).toEqual([])
  })

  it('refuses the cloud metadata endpoint', async () => {
    expect(await reasonOf(safeFetch('http://169.254.169.254/latest/meta-data/'))).toBe('blocked')
  })

  it.each([
    'http://10.1.2.3/admin',
    'http://192.168.1.1/',
    'http://172.20.0.5/printer',
    'http://[::1]:8080/',
    'http://[fd00::1]/nas',
  ])('refuses %s', async (url) => {
    expect(await reasonOf(safeFetch(url, { timeoutMs: 2000 }))).toBe('blocked')
  })

  it('leaks neither the body nor the resolved address in the error', async () => {
    allowLoopback()
    const text = (await safeFetchText(`http://127.0.0.1:${port}/secret`)).text
    expect(text).toBe(SECRET) // the allowlisted case really does work…

    delete process.env.BETTS_ALLOW_PRIVATE_FETCH_HOSTS
    let message = ''
    try {
      await safeFetch(`http://127.0.0.1:${port}/secret`)
    }
    catch (err) {
      message = (err as Error).message
    }
    // …and blocked, it says nothing an attacker can use to map the network.
    expect(message).not.toContain(SECRET)
    expect(message).not.toContain('127.0.0.1')
    // Identical text for blocked and unreachable: no oracle.
    expect(message).toBe(new SafeFetchError('network').message)
  })
})

describe('safeFetch redirect handling', () => {
  it('re-validates each hop: a permitted host may not redirect us to loopback', async () => {
    // Hop 1 is allowlisted (stands in for a public site); hop 2 is not.
    allowLoopback()
    expect(await reasonOf(safeFetch(`http://127.0.0.1:${port}/redirect-to-loopback`))).toBe('blocked')
    expect(hits).toEqual(['/redirect-to-loopback']) // /secret was never served
  })

  it('refuses a redirect that changes scheme to file:', async () => {
    allowLoopback()
    expect(await reasonOf(safeFetch(`http://127.0.0.1:${port}/redirect-to-file`))).toBe('redirect')
  })

  it('stops a redirect loop at the hop cap', async () => {
    allowLoopback()
    expect(await reasonOf(safeFetch(`http://127.0.0.1:${port}/redirect-loop`))).toBe('redirect')
    expect(hits.length).toBeLessThanOrEqual(6) // 1 + maxRedirects
  })

  it('follows redirects that stay legitimate', async () => {
    allowLoopback()
    // maxRedirects 0 proves the cap is honoured at the boundary.
    expect(await reasonOf(safeFetch(`http://127.0.0.1:${port}/redirect-loop`, { maxRedirects: 0 }))).toBe('redirect')
    expect(hits).toEqual(['/redirect-loop'])
  })
})

describe('safeFetch budgets cover the body, not just the headers', () => {
  it('aborts a response whose headers arrive but whose body never ends', async () => {
    allowLoopback()
    const started = Date.now()
    expect(await reasonOf(safeFetch(`http://127.0.0.1:${port}/slow`, { timeoutMs: 500 }))).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('stops an endless body at maxBytes instead of buffering it', async () => {
    allowLoopback()
    const started = Date.now()
    expect(await reasonOf(safeFetch(`http://127.0.0.1:${port}/endless`, { maxBytes: 100_000, timeoutMs: 10_000 })))
      .toBe('too-large')
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('refuses an oversized content-length without reading a byte', async () => {
    allowLoopback()
    expect(await reasonOf(safeFetch(`http://127.0.0.1:${port}/lying-length`, { maxBytes: 1000 }))).toBe('too-large')
  })

  it('still returns a normal response inside the limits', async () => {
    allowLoopback()
    const res = await safeFetchText(`http://127.0.0.1:${port}/secret`, { maxBytes: 1_000_000 })
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(res.text).toBe(SECRET)
  })
})

describe('callers route their outbound fetches through safeFetch', () => {
  let db: Db
  let householdId: string

  beforeEach(() => {
    db = createDb(':memory:')
    migrate(db, { migrationsFolder: 'drizzle' })
    householdId = db.insert(households).values({
      name: 'Test', passwordHash: 'x', timezone: 'UTC', icsToken: 'tok',
      settings: defaultHouseholdSettings,
    }).returning().get().id
  })

  it('recipe import cannot be pointed at the LAN', async () => {
    await expect(importRecipeFromUrl(db, { householdId, url: `http://127.0.0.1:${port}/recipe` }))
      .rejects.toMatchObject({ statusCode: 422 })
    expect(hits).toEqual([])
  })

  it('recipe import refuses a non-http scheme outright', async () => {
    await expect(importRecipeFromUrl(db, { householdId, url: 'file:///etc/passwd' }))
      .rejects.toMatchObject({ statusCode: 422 })
  })

  it('an ICS feed cannot be pointed at the LAN, and says nothing useful when it is', async () => {
    const feed = db.insert(calendarFeeds).values({
      householdId, name: 'Router', url: `http://127.0.0.1:${port}/feed.ics`, color: '#0ea5e9',
    }).returning().get()

    const result = await refreshFeed(db, feed)

    expect(result.ok).toBe(false)
    expect(hits).toEqual([])
    expect(db.select().from(events).where(eq(events.feedId, feed.id)).all()).toEqual([])
    // The stored error is shown in the admin UI — it must not carry the target.
    const stored = db.select().from(calendarFeeds).where(eq(calendarFeeds.id, feed.id)).get()!
    expect(stored.lastError).not.toContain('127.0.0.1')
    expect(stored.lastError).not.toContain(SECRET)
  })

  it('an ICS feed on an explicitly allowed host still imports', async () => {
    allowLoopback()
    const feed = db.insert(calendarFeeds).values({
      householdId, name: 'NAS', url: `http://127.0.0.1:${port}/feed.ics`, color: '#0ea5e9',
    }).returning().get()

    const result = await refreshFeed(db, feed)

    expect(result.ok).toBe(true)
    expect(result.imported).toBe(1)
  })
})
