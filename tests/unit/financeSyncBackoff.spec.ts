import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings, financeAccounts, financeConnections,
  financeTransactions, households,
} from '../../server/db/schema'
import { installNitroGlobals } from '../support/nitroGlobals'

installNitroGlobals()

/**
 * The backoff is the part with real consequences: against a rate-limited bank
 * API, a connection that retries on every tick is how a household gets
 * blocked. These drive syncConnection against a stub bridge and assert on the
 * row it leaves behind.
 */

let stub: Server
let respond: () => { status: number, body: string }
let db: Db
let householdId: string

type SyncModule = typeof import('../../server/services/finance/sync')
let syncConnection: SyncModule['syncConnection']
let storeAccessUrl: SyncModule['storeAccessUrl']

beforeAll(async () => {
  stub = createServer((req, res) => {
    const result = respond()
    res.writeHead(result.status, { 'Content-Type': 'application/json' })
    res.end(result.body)
  })
  await new Promise<void>(resolve => stub.listen(0, '127.0.0.1', resolve))
  process.env.BETTS_SIMPLEFIN_HOSTS = '127.0.0.1'
  process.env.BETTS_DATA_DIR = `/tmp/betts-sync-${process.pid}`
  ;({ syncConnection, storeAccessUrl } = await import('../../server/services/finance/sync'))

  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
})

afterAll(async () => {
  delete process.env.BETTS_SIMPLEFIN_HOSTS
  await new Promise<void>(resolve => stub.close(() => resolve()))
})

function accessUrl() {
  return `http://u:p@127.0.0.1:${(stub.address() as AddressInfo).port}/simplefin`
}

function makeConnection(over: Partial<typeof financeConnections.$inferInsert> = {}) {
  return db.insert(financeConnections).values({
    householdId,
    provider: 'simplefin',
    accessUrlEnc: storeAccessUrl(accessUrl()),
    syncIntervalMinutes: 360,
    ...over,
  }).returning().get()
}

const row = (id: string) =>
  db.select().from(financeConnections).where(eq(financeConnections.id, id)).get()!

function payload(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    accounts: [{
      id: 'ACT-1',
      name: 'Checking',
      currency: 'USD',
      balance: '100.00',
      transactions: [
        { id: 'T1', posted: 1767225600, amount: '-10.00', description: 'Shop' },
      ],
    }],
    ...over,
  })
}

beforeEach(() => {
  db.delete(financeTransactions).run()
  db.delete(financeAccounts).run()
  db.delete(financeConnections).run()
  db.delete(households).run()
  householdId = db.insert(households).values({
    name: 'Betts', passwordHash: 'x', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get().id
  respond = () => ({ status: 200, body: payload() })
})

describe('a successful sync', () => {
  it('records the watermark and schedules the next attempt', async () => {
    const connection = makeConnection()
    const outcome = await syncConnection(db, connection)

    expect(outcome.status).toBe('ok')
    expect(outcome.inserted).toBe(1)
    const after = row(connection.id)
    expect(after.lastSyncAt).not.toBeNull()
    expect(after.consecutiveFailures).toBe(0)
    expect(after.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now())
  })
})

describe('a failing sync', () => {
  it('backs off instead of staying due, so it cannot retry every tick', async () => {
    respond = () => ({ status: 500, body: 'boom' })
    const connection = makeConnection()
    await syncConnection(db, connection)

    const after = row(connection.id)
    expect(after.status).toBe('error')
    expect(after.consecutiveFailures).toBe(1)
    // The bug this guards: without nextAttemptAt the due predicate matches on
    // every hourly tick forever.
    expect(after.nextAttemptAt).not.toBeNull()
    expect(after.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now())
    // "Tried" and "succeeded" are separate columns.
    expect(after.lastAttemptAt).not.toBeNull()
    expect(after.lastSyncAt).toBeNull()
  })

  it('lengthens the wait as failures accumulate', async () => {
    respond = () => ({ status: 500, body: 'boom' })
    const first = makeConnection()
    await syncConnection(db, first)
    const afterOne = row(first.id).nextAttemptAt!.getTime() - Date.now()

    const later = makeConnection({ consecutiveFailures: 4 })
    await syncConnection(db, later)
    const afterFive = row(later.id).nextAttemptAt!.getTime() - Date.now()

    expect(afterFive).toBeGreaterThan(afterOne * 2)
  })

  it('waits a long time when the bank wants re-authentication', async () => {
    respond = () => ({ status: 403, body: 'no' })
    const connection = makeConnection()
    await syncConnection(db, connection)

    const after = row(connection.id)
    expect(after.status).toBe('needs_reauth')
    // Hammering a connection that needs a human helps nobody.
    expect(after.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(12 * 60 * 60_000)
  })

  it('never throws, so one bad bank cannot stop the others', async () => {
    respond = () => ({ status: 500, body: 'boom' })
    await expect(syncConnection(db, makeConnection())).resolves.toBeTruthy()
  })

  it('reports unreadable credentials without feeding the backoff counter', async () => {
    // A missing encryption key is not a network problem; counting it as one
    // buries the real cause under retry churn.
    const connection = makeConnection({ accessUrlEnc: 'v1.not.a.real.envelope' })
    const outcome = await syncConnection(db, connection)

    expect(outcome.error).toContain('credentials')
    const after = row(connection.id)
    expect(after.consecutiveFailures).toBe(0)
    expect(after.lastError).toMatch(/encryption key/i)
  })
})

describe('a partial sync', () => {
  it('ingests what came back and reports the institution that did not', async () => {
    respond = () => ({ status: 200, body: payload({ errlist: ['Chase needs re-authentication'] }) })
    const connection = makeConnection()
    const outcome = await syncConnection(db, connection)

    expect(outcome.status).toBe('partial')
    expect(outcome.inserted).toBe(1)
    expect(row(connection.id).lastErrorList).toEqual(['Chase needs re-authentication'])
  })

  it('does NOT advance the watermark past the gap', async () => {
    // Moving lastSyncAt forward when one bank returned nothing means the next
    // fetch window starts after the missing period, and those transactions are
    // never asked for again. Re-fetching a window we already have is free.
    respond = () => ({ status: 200, body: payload({ errlist: ['Chase is down'] }) })
    const connection = makeConnection()
    await syncConnection(db, connection)

    expect(row(connection.id).lastSyncAt).toBeNull()
    // It still schedules a normal next attempt rather than backing off.
    expect(row(connection.id).nextAttemptAt).not.toBeNull()
    expect(row(connection.id).consecutiveFailures).toBe(0)
  })

  it('advances the watermark once every institution reports cleanly', async () => {
    respond = () => ({ status: 200, body: payload({ errlist: ['Chase is down'] }) })
    const connection = makeConnection()
    await syncConnection(db, connection)
    expect(row(connection.id).lastSyncAt).toBeNull()

    respond = () => ({ status: 200, body: payload() })
    await syncConnection(db, row(connection.id))
    expect(row(connection.id).lastSyncAt).not.toBeNull()
    expect(row(connection.id).status).toBe('ok')
  })
})
