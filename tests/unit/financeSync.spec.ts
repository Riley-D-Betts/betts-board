import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { asc, eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings, financeAccounts, financeCategories, financeConnections,
  financeRules, financeTransactionSplits, financeTransactions, households,
} from '../../server/db/schema'
import { installNitroGlobals } from '../support/nitroGlobals'
import type { SimpleFinAccount } from '../../server/services/finance/simplefin'

installNitroGlobals()

const { ingestAccount, connectionsDue } = await import('../../server/services/finance/sync')
const { setSplits } = await import('../../server/services/finance/splits')

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

  /**
   * The whole "hide a bank account" feature rests on this: the server refuses
   * to DELETE a synced account because the next sync would recreate it, so the
   * UI archives instead. If a sync ever cleared archivedAt, a hidden account
   * would silently reappear on the family's board.
   */
  it('leaves a hidden account hidden across syncs', () => {
    ingestAccount(db, connection, account(), WINDOW_START)
    const row = db.select().from(financeAccounts).get()!
    db.update(financeAccounts).set({ archivedAt: new Date('2026-02-02T00:00:00Z') })
      .where(eq(financeAccounts.id, row.id)).run()

    // A later sync brings a new balance and a new transaction.
    ingestAccount(db, connection, account({
      balanceMinor: -1000,
      transactions: [{
        id: 'TRN-2',
        postedAt: new Date('2026-01-20T12:00:00Z'),
        amountMinor: -500,
        description: 'Later',
        payee: null,
        memo: null,
        pending: false,
      }],
    }), WINDOW_START)

    const after = db.select().from(financeAccounts).get()!
    expect(after.archivedAt).not.toBeNull() // still hidden
    expect(after.balanceMinor).toBe(-1000) // but still kept up to date
  })

  /**
   * The reported symptom: "transactions from this morning aren't there even
   * after I sync." A same-day card payment arrives as a PENDING hold, so it
   * has to reach the ledger flagged pending — visible, but not yet counted.
   */
  it('ingests a pending charge so today shows up right away', () => {
    ingestAccount(db, connection, account({
      transactions: [{
        id: 'TRN-PENDING',
        postedAt: new Date('2026-02-01T09:00:00Z'),
        amountMinor: -1299,
        description: 'Coffee this morning',
        payee: null,
        memo: null,
        pending: true,
      }],
    }), WINDOW_START)

    const row = db.select().from(financeTransactions).get()!
    expect(row.description).toBe('Coffee this morning')
    expect(row.pending).toBe(true)
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
    setSplits(db, txn.id, txn.amountMinor, [
      { categoryId: category.id, amountMinor: txn.amountMinor, categorizedBy: 'user' },
    ])
    db.update(financeTransactions).set({ notes: 'split with Sam' })
      .where(eq(financeTransactions.id, txn.id)).run()

    const amended = account()
    amended.transactions[0]!.amountMinor = -4000
    ingestAccount(db, connection, amended, WINDOW_START)

    const after = db.select().from(financeTransactions).get()!
    const splits = db.select().from(financeTransactionSplits).all()
    expect(splits).toHaveLength(1)
    expect(splits[0]!.categoryId).toBe(category.id)
    expect(splits[0]!.categorizedBy).toBe('user')
    expect(after.notes).toBe('split with Sam')
    expect(after.amountMinor).toBe(-4000)
    // The line followed the bank's new amount — an unsplit transaction has
    // only one place the difference can go.
    expect(splits[0]!.amountMinor).toBe(-4000)
  })

  /**
   * The invariant under the one thing that can move an amount without a person
   * being there to re-divide it: a tip posting after the meal.
   */
  it('keeps a hand-made split adding up when the bank amends the amount', () => {
    ingestAccount(db, connection, account(), WINDOW_START)
    const [food, drinks] = ['Food', 'Drinks'].map(name => db.insert(financeCategories)
      .values({ householdId, name, kind: 'expense' }).returning().get())
    // A round meal total to divide, so the arithmetic below is readable.
    const settled = account()
    settled.transactions[0]!.amountMinor = -5000
    ingestAccount(db, connection, settled, WINDOW_START)

    const txn = db.select().from(financeTransactions).get()!
    setSplits(db, txn.id, -5000, [
      { categoryId: food!.id, amountMinor: -3000 },
      { categoryId: drinks!.id, amountMinor: -2000 },
    ])

    const tipped = account()
    tipped.transactions[0]!.amountMinor = -6000 // 20% tip posted later
    ingestAccount(db, connection, tipped, WINDOW_START)

    const splits = db.select().from(financeTransactionSplits)
      .orderBy(asc(financeTransactionSplits.sortOrder)).all()
    expect(splits.map(s => s.amountMinor)).toEqual([-3600, -2400])
    expect(splits.reduce((acc, s) => acc + s.amountMinor, 0)).toBe(-6000)
    expect(splits.map(s => s.categoryId)).toEqual([food!.id, drinks!.id])
  })

  it('never leaves a rounded rebalance a penny out', () => {
    ingestAccount(db, connection, account(), WINDOW_START)
    const category = db.insert(financeCategories)
      .values({ householdId, name: 'Food', kind: 'expense' }).returning().get()
    const settled = account()
    settled.transactions[0]!.amountMinor = -5000
    ingestAccount(db, connection, settled, WINDOW_START)

    const txn = db.select().from(financeTransactions).get()!
    setSplits(db, txn.id, -5000, [
      { categoryId: category.id, amountMinor: -1667 },
      { categoryId: category.id, amountMinor: -1667 },
      { categoryId: category.id, amountMinor: -1666 },
    ])

    const amended = account()
    amended.transactions[0]!.amountMinor = -3333
    ingestAccount(db, connection, amended, WINDOW_START)

    const splits = db.select().from(financeTransactionSplits).all()
    expect(splits.reduce((acc, s) => acc + s.amountMinor, 0)).toBe(-3333)
    expect(splits.every(s => s.amountMinor < 0)).toBe(true)
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

  /**
   * A payload with no parseable balance arrives as balanceMinor: null. Writing
   * 0 in that case zeroed the family's real balance on every sync — the bug
   * behind "it syncs transactions but not account values".
   */
  it('keeps the stored balance when the payload has none', () => {
    ingestAccount(db, connection, account(), WINDOW_START)

    ingestAccount(db, connection, account({
      balanceMinor: null,
      availableBalanceMinor: null,
      balanceAt: null,
    }), WINDOW_START)

    const row = db.select().from(financeAccounts).get()!
    expect(row.balanceMinor).toBe(-3329343)
    // The as-of time describes the kept number, so it is kept too.
    expect(row.balanceAt?.toISOString()).toBe('2026-02-01T12:00:00.000Z')
  })

  it('still updates a good available balance while the main balance is unparseable', () => {
    // The two are parsed independently, and a bridge can mangle one while
    // sending the other intact — the fresh number must not be held hostage.
    ingestAccount(db, connection, account(), WINDOW_START)
    ingestAccount(db, connection, account({
      balanceMinor: null,
      availableBalanceMinor: 51233,
      balanceAt: null,
    }), WINDOW_START)

    const row = db.select().from(financeAccounts).get()!
    expect(row.balanceMinor).toBe(-3329343)
    expect(row.availableBalanceMinor).toBe(51233)
  })

  it('still updates the balance when a later payload has one again', () => {
    ingestAccount(db, connection, account(), WINDOW_START)
    ingestAccount(db, connection, account({ balanceMinor: null }), WINDOW_START)
    ingestAccount(db, connection, account({ balanceMinor: -100 }), WINDOW_START)
    expect(db.select().from(financeAccounts).get()!.balanceMinor).toBe(-100)
  })

  it('creates a first-sync account with a missing balance as 0, not a crash', () => {
    ingestAccount(db, connection, account({
      balanceMinor: null,
      availableBalanceMinor: null,
      balanceAt: new Date('2026-02-01T12:00:00Z'),
    }), WINDOW_START)

    const row = db.select().from(financeAccounts).get()!
    expect(row.balanceMinor).toBe(0)
    // No balance means the as-of time describes nothing — it must not be set.
    expect(row.balanceAt).toBeNull()
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
