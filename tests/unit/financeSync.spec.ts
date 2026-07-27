import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings, financeAccounts, financeCategories, financeConnections,
  financeRules, financeTransactions, households,
} from '../../server/db/schema'
import { installNitroGlobals } from '../support/nitroGlobals'
import type { SimpleFinAccount } from '../../server/services/finance/simplefin'

installNitroGlobals()

const { ingestAccount, connectionsDue } = await import('../../server/services/finance/sync')

let db: Db
let householdId: string
let connection: typeof financeConnections.$inferSelect

beforeAll(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
})

beforeEach(() => {
  db.delete(financeTransactions).run()
  db.delete(financeRules).run()
  db.delete(financeCategories).run()
  db.delete(financeAccounts).run()
  db.delete(financeConnections).run()
  db.delete(households).run()

  const hh = db.insert(households).values({
    name: 'Betts', passwordHash: 'x', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get()
  householdId = hh.id

  connection = db.insert(financeConnections).values({
    householdId,
    provider: 'simplefin',
    // Not a real envelope; ingestAccount never decrypts.
    accessUrlEnc: 'v1.x.y.z',
  }).returning().get()
})

const WINDOW_START = new Date('2026-01-01T00:00:00Z')

function account(over: Partial<SimpleFinAccount> = {}): SimpleFinAccount {
  return {
    externalId: 'ACT-1',
    orgName: 'My Bank',
    name: 'Checking',
    currency: 'USD',
    balanceMinor: -3329343,
    availableBalanceMinor: -3391199,
    balanceAt: new Date('2026-02-01T12:00:00Z'),
    transactions: [
      {
        id: 'TRN-1',
        postedAt: new Date('2026-01-15T12:00:00Z'),
        amountMinor: -3353,
        description: 'Bait Shop',
        payee: null,
        memo: null,
        pending: false,
      },
    ],
    ...over,
  }
}

describe('ingestAccount', () => {
  it('creates the account and its transactions on first sync', () => {
    const result = ingestAccount(db, connection, account(), WINDOW_START)
    expect(result.inserted).toBe(1)

    const row = db.select().from(financeAccounts).get()!
    expect(row.externalId).toBe('ACT-1')
    expect(row.balanceMinor).toBe(-3329343)
    // The bank owns this number — never recomputed from the rows.
    expect(row.balanceSource).toBe('bank')
    expect(row.type).toBe('checking')
  })

  it('is idempotent: the same payload twice inserts nothing new', () => {
    ingestAccount(db, connection, account(), WINDOW_START)
    const second = ingestAccount(db, connection, account(), WINDOW_START)

    expect(second.inserted).toBe(0)
    expect(second.updated).toBe(0)
    expect(db.select().from(financeTransactions).all()).toHaveLength(1)
    expect(db.select().from(financeAccounts).all()).toHaveLength(1)
  })

  it('updates an amended transaction in place rather than duplicating it', () => {
    ingestAccount(db, connection, account(), WINDOW_START)
    const amended = account()
    amended.transactions[0]!.amountMinor = -4000
    amended.transactions[0]!.description = 'Bait Shop (adjusted)'

    const result = ingestAccount(db, connection, amended, WINDOW_START)
    expect(result.updated).toBe(1)
    const rows = db.select().from(financeTransactions).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.amountMinor).toBe(-4000)
  })

  it('keeps a category the family set by hand across a re-sync', () => {
    ingestAccount(db, connection, account(), WINDOW_START)
    const category = db.insert(financeCategories)
      .values({ householdId, name: 'Fishing', kind: 'expense' }).returning().get()
    const txn = db.select().from(financeTransactions).get()!
    db.update(financeTransactions)
      .set({ categoryId: category.id, categorizedBy: 'user', notes: 'split with Sam' })
      .where(eq(financeTransactions.id, txn.id)).run()

    const amended = account()
    amended.transactions[0]!.amountMinor = -4000
    ingestAccount(db, connection, amended, WINDOW_START)

    const after = db.select().from(financeTransactions).get()!
    expect(after.categoryId).toBe(category.id)
    expect(after.categorizedBy).toBe('user')
    expect(after.notes).toBe('split with Sam')
    expect(after.amountMinor).toBe(-4000)
  })

  it('flips pending to posted on the same row', () => {
    const pending = account()
    pending.transactions[0]!.pending = true
    ingestAccount(db, connection, pending, WINDOW_START)
    expect(db.select().from(financeTransactions).get()!.pending).toBe(true)

    ingestAccount(db, connection, account(), WINDOW_START)
    const rows = db.select().from(financeTransactions).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.pending).toBe(false)
  })

  it('removes a pending row the bank stopped listing inside the window', () => {
    const pending = account()
    pending.transactions[0]!.pending = true
    ingestAccount(db, connection, pending, WINDOW_START)

    // The bank still reports the account and other activity — it simply no
    // longer lists this hold, so the hold really is gone.
    const stillReporting = account({
      transactions: [{
        id: 'TRN-OTHER',
        postedAt: new Date('2026-01-20T12:00:00Z'),
        amountMinor: -500,
        description: 'Something else',
        payee: null,
        memo: null,
        pending: false,
      }],
    })
    const result = ingestAccount(db, connection, stillReporting, WINDOW_START)
    expect(result.removedPending).toBe(1)
    expect(db.select().from(financeTransactions).all().map(r => r.externalId)).toEqual(['TRN-OTHER'])
  })

  it('does NOT clear pending rows when the bank returns nothing at all', () => {
    // An empty transaction list means "this institution told us nothing" far
    // more often than "every pending charge was cancelled". Treating it as the
    // latter wipes every pending row the family can see, on a bad day at the
    // bank, with no way to get them back before they post.
    const pending = account()
    pending.transactions[0]!.pending = true
    ingestAccount(db, connection, pending, WINDOW_START)

    const result = ingestAccount(db, connection, account({ transactions: [] }), WINDOW_START)
    expect(result.removedPending).toBe(0)
    expect(db.select().from(financeTransactions).all()).toHaveLength(1)
  })

  it('leaves pending rows dated before the fetched window alone', () => {
    const pending = account()
    pending.transactions[0]!.pending = true
    pending.transactions[0]!.postedAt = new Date('2026-01-01T12:00:00Z')
    ingestAccount(db, connection, pending, WINDOW_START)

    // Re-syncing with a window that starts on that same day: the row sits on
    // the boundary, so the bank was not necessarily asked about it.
    const result = ingestAccount(db, connection, account(), WINDOW_START)
    expect(result.removedPending).toBe(0)
  })

  it('does NOT remove a posted row the bank stopped listing', () => {
    ingestAccount(db, connection, account(), WINDOW_START)
    const result = ingestAccount(db, connection, account({ transactions: [] }), WINDOW_START)
    expect(result.removedPending).toBe(0)
    expect(db.select().from(financeTransactions).all()).toHaveLength(1)
  })

  it('keeps two connections’ identical transaction ids apart', () => {
    const other = db.insert(financeConnections).values({
      householdId, provider: 'simplefin', accessUrlEnc: 'v1.a.b.c',
    }).returning().get()

    ingestAccount(db, connection, account(), WINDOW_START)
    ingestAccount(db, other, account(), WINDOW_START)

    expect(db.select().from(financeAccounts).all()).toHaveLength(2)
    expect(db.select().from(financeTransactions).all()).toHaveLength(2)
  })

  it('applies categorisation rules to newly synced rows', () => {
    db.insert(financeRules).values({
      householdId,
      matchField: 'description',
      matchType: 'contains',
      matchValue: 'bait',
      setPayee: 'Uncle Frank',
    }).run()

    ingestAccount(db, connection, account(), WINDOW_START)
    expect(db.select().from(financeTransactions).get()!.payee).toBe('Uncle Frank')
  })

  it('stores a zero-decimal currency without inflating the balance', () => {
    ingestAccount(db, connection, account({ currency: 'JPY', balanceMinor: 1000, transactions: [] }), WINDOW_START)
    const row = db.select().from(financeAccounts).get()!
    expect(row.currency).toBe('JPY')
    expect(row.currencyExponent).toBe(0)
    expect(row.balanceMinor).toBe(1000)
  })

  it('records the posted DATE separately, so no timezone can move a row a day', () => {
    ingestAccount(db, connection, account(), WINDOW_START)
    expect(db.select().from(financeTransactions).get()!.postedDate).toMatch(/^2026-01-15$/)
  })
})

describe('connectionsDue', () => {
  it('includes a connection that has never synced', () => {
    expect(connectionsDue(db).map(c => c.id)).toContain(connection.id)
  })

  it('excludes one whose next attempt is in the future — this is the backoff', () => {
    db.update(financeConnections)
      .set({ nextAttemptAt: new Date(Date.now() + 3_600_000) })
      .where(eq(financeConnections.id, connection.id)).run()
    expect(connectionsDue(db)).toHaveLength(0)
  })

  it('includes one whose next attempt has passed', () => {
    db.update(financeConnections)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(financeConnections.id, connection.id)).run()
    expect(connectionsDue(db)).toHaveLength(1)
  })

  it('never picks up a paused connection', () => {
    db.update(financeConnections).set({ status: 'disabled' })
      .where(eq(financeConnections.id, connection.id)).run()
    expect(connectionsDue(db)).toHaveLength(0)
  })

  it('still retries one that needs re-auth, just far apart', () => {
    db.update(financeConnections)
      .set({ status: 'needs_reauth', nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(financeConnections.id, connection.id)).run()
    expect(connectionsDue(db)).toHaveLength(1)
  })
})
