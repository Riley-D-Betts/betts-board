import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { createDb, type Db } from '../../server/db/client'
import { defaultHouseholdSettings, households } from '../../server/db/schema'
import { getFeedbackStatus, updateFeedbackSettings } from '../../server/services/feedback/settings'

// ── Stub GitHub API ─────────────────────────────────────────────────────
// A local node:http server on an ephemeral port stands in for api.github.com.
// github.ts reads BETTS_GITHUB_API_URL once at module load, so the stub must
// be listening (port known) before the service is imported — hence the
// dynamic import in beforeAll.

type FeedbackGithub = typeof import('../../server/services/feedback/github')
let createIssue: FeedbackGithub['createIssue']
let testConnection: FeedbackGithub['testConnection']

interface StubCall {
  method: string
  url: string
  headers: IncomingHttpHeaders
  body: Record<string, unknown> | null
}

let stub: Server
let calls: StubCall[]
/**
 * Per-test behavior: JSON response, 'destroy' to simulate a network failure,
 * or 'endless' — headers immediately, body forever. 'endless' is the shape a
 * timer cleared when fetch() resolves does nothing about, because res.json()
 * then runs with no abort armed at all.
 */
let respond: () => { status: number, json: unknown } | 'destroy' | 'endless'

beforeAll(async () => {
  stub = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      calls.push({
        method: req.method!,
        url: req.url!,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      })
      const reply = respond()
      if (reply === 'destroy') {
        res.destroy()
        return
      }
      if (reply === 'endless') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        const pump = () => {
          if (res.writableEnded || res.destroyed) return
          if (res.write('x'.repeat(64 * 1024))) setTimeout(pump, 1)
          else res.once('drain', pump)
        }
        pump()
        return
      }
      res.writeHead(reply.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(reply.json))
    })
  })
  await new Promise<void>(resolve => stub.listen(0, '127.0.0.1', resolve))
  const { port } = stub.address() as AddressInfo
  process.env.BETTS_GITHUB_API_URL = `http://127.0.0.1:${port}`
  ;({ createIssue, testConnection } = await import('../../server/services/feedback/github'))
})

afterAll(() => {
  // The 'endless' case leaves a socket mid-response on purpose.
  stub.closeAllConnections()
  return new Promise<void>((resolve, reject) =>
    stub.close(err => (err ? reject(err) : resolve())))
})

// ── Fixture household ───────────────────────────────────────────────────

const TOKEN = 'github_pat_supersecret'
let db: Db
let householdId: string

beforeEach(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  householdId = db.insert(households).values({
    name: 'Test',
    passwordHash: 'x',
    timezone: 'America/Boise',
    icsToken: 'tok',
    githubRepo: 'betts/board',
    githubToken: TOKEN,
    settings: defaultHouseholdSettings,
  }).returning().get().id
  calls = []
  respond = () => ({ status: 200, json: {} })
})

function householdRow() {
  return db.select().from(households).where(eq(households.id, householdId)).get()!
}

// ── createIssue ─────────────────────────────────────────────────────────

describe('createIssue', () => {
  it('POSTs the issue with the documented headers, labels, and footer', async () => {
    respond = () => ({
      status: 201,
      json: { number: 42, html_url: 'https://github.com/betts/board/issues/42' },
    })

    const result = await createIssue(db, {
      kind: 'bug',
      title: 'Chore board shows yesterday',
      body: 'Checked at 7am, still shows Tuesday.',
      reporterName: 'Mom',
      diagnostics: { userAgent: 'TestBrowser/1.0', viewport: '1024×768', version: '1.0.0' },
    })
    expect(result).toEqual({
      ok: true,
      issueNumber: 42,
      issueUrl: 'https://github.com/betts/board/issues/42',
    })

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.method).toBe('POST')
    expect(call.url).toBe('/repos/betts/board/issues')
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(call.headers.accept).toBe('application/vnd.github+json')
    expect(call.headers['x-github-api-version']).toBe('2022-11-28')
    expect(call.headers['user-agent']).toBe('betts-board')

    expect(call.body).toMatchObject({
      title: 'Chore board shows yesterday',
      labels: ['bug'],
    })
    const body = call.body!.body as string
    expect(body).toContain('Checked at 7am, still shows Tuesday.')
    expect(body).toContain('Reported by Mom via Betts Board v1.0.0')
    expect(body).toContain('Browser: TestBrowser/1.0')
    expect(body).toContain('Viewport: 1024×768')
  })

  it('labels feature requests enhancement and skips diagnostics lines', async () => {
    respond = () => ({ status: 201, json: { number: 7, html_url: 'https://github.com/betts/board/issues/7' } })

    await createIssue(db, {
      kind: 'feature',
      title: 'Birthday countdowns',
      body: 'Countdown tiles on the dashboard.',
      reporterName: 'Kid',
    })

    const body = calls[0]!.body!
    expect(body.labels).toEqual(['enhancement'])
    expect(body.body).toContain('Reported by Kid via Betts Board v')
    expect(body.body).not.toContain('Browser:')
    expect(body.body).not.toContain('Viewport:')
  })

  it('throws 409 without ever calling GitHub when unconfigured', async () => {
    db.update(households).set({ githubToken: null }).where(eq(households.id, householdId)).run()

    await expect(createIssue(db, {
      kind: 'bug', title: 'Nope', body: 'x', reporterName: 'Mom',
    })).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Feedback is not connected to GitHub yet',
    })
    expect(calls).toHaveLength(0)
  })

  it.each([
    [401, 'GitHub rejected the token'],
    [403, 'GitHub rejected the token'],
    [404, 'Repo not found or token lacks access'],
    [410, 'Issues are disabled on the repo'],
  ])('maps upstream %i to a 502 with an actionable message', async (status, statusMessage) => {
    respond = () => ({ status, json: { message: 'nope' } })

    await expect(createIssue(db, {
      kind: 'bug', title: 'Broken', body: 'x', reporterName: 'Mom',
    })).rejects.toMatchObject({ statusCode: 502, statusMessage })
  })

  it('maps a dropped connection to 502 Could not reach GitHub', async () => {
    respond = () => 'destroy'

    await expect(createIssue(db, {
      kind: 'bug', title: 'Broken', body: 'x', reporterName: 'Mom',
    })).rejects.toMatchObject({ statusCode: 502, statusMessage: 'Could not reach GitHub' })
  })

  // The 10 s AbortController timeout path is intentionally untested — it would
  // add 10 real seconds to the suite for the same catch branch the dropped-
  // connection test already covers.

  // A response whose headers arrive and whose body never ends is the case the
  // old timer missed entirely: it was cleared when fetch() resolved, so the
  // res.json() that followed had nothing armed and streamed into memory until
  // the container fell over. Revert to a live Response + res.json() and this
  // test buffers until vitest kills it.
  it('stops an endless response body instead of buffering it', async () => {
    respond = () => 'endless'
    const started = Date.now()

    await expect(createIssue(db, {
      kind: 'bug', title: 'Broken', body: 'x', reporterName: 'Mom',
    })).rejects.toMatchObject({ statusCode: 502 })

    expect(Date.now() - started).toBeLessThan(9000) // inside the 10 s budget
  }, 15_000)
})

// ── testConnection ──────────────────────────────────────────────────────

describe('testConnection', () => {
  it('GETs the repo with the token and returns its full name', async () => {
    respond = () => ({ status: 200, json: { full_name: 'betts/board' } })

    await expect(testConnection(db)).resolves.toEqual({ ok: true, repoFullName: 'betts/board' })

    const call = calls[0]!
    expect(call.method).toBe('GET')
    expect(call.url).toBe('/repos/betts/board')
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('maps the same upstream errors as createIssue', async () => {
    respond = () => ({ status: 404, json: { message: 'Not Found' } })
    await expect(testConnection(db)).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: 'Repo not found or token lacks access',
    })
  })

  it('throws 409 when unconfigured', async () => {
    db.update(households).set({ githubRepo: null }).where(eq(households.id, householdId)).run()
    await expect(testConnection(db)).rejects.toMatchObject({ statusCode: 409 })
    expect(calls).toHaveLength(0)
  })
})

// ── Settings + status ───────────────────────────────────────────────────

describe('updateFeedbackSettings', () => {
  it('keeps the stored token when the update omits it', () => {
    const status = updateFeedbackSettings(db, { repo: 'new/home' })
    expect(status).toEqual({ configured: true, repo: 'new/home' })
    expect(householdRow().githubRepo).toBe('new/home')
    expect(householdRow().githubToken).toBe(TOKEN)
  })

  it('replaces the token when one is provided', () => {
    updateFeedbackSettings(db, { repo: 'betts/board', token: 'ghp_replacement' })
    expect(householdRow().githubToken).toBe('ghp_replacement')
  })

  it('clears both repo and token on repo: null', () => {
    const status = updateFeedbackSettings(db, { repo: null })
    expect(status).toEqual({ configured: false, repo: null })
    expect(householdRow().githubRepo).toBeNull()
    expect(householdRow().githubToken).toBeNull()
  })
})

describe('getFeedbackStatus', () => {
  it('reports configured with the repo, and never leaks the token', () => {
    const status = getFeedbackStatus(db)
    expect(status).toEqual({ configured: true, repo: 'betts/board' })
    expect(Object.keys(status).sort()).toEqual(['configured', 'repo'])
    expect(JSON.stringify(status)).not.toContain(TOKEN)
  })

  it('is unconfigured when either half is missing', () => {
    db.update(households).set({ githubToken: null }).where(eq(households.id, householdId)).run()
    // Repo still shown so the settings UI can prefill it.
    expect(getFeedbackStatus(db)).toEqual({ configured: false, repo: 'betts/board' })

    db.update(households).set({ githubRepo: null }).where(eq(households.id, householdId)).run()
    expect(getFeedbackStatus(db)).toEqual({ configured: false, repo: null })
  })
})
