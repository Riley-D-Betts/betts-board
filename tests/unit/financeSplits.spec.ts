import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { and, eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings, financeAccounts, financeBills, financeBudgets,
  financeCategories, financeConnections, financeRules, financeTransactionSplits,
  financeTransactions, households, profiles,
} from '../../server/db/schema'
import { installNitroGlobals } from '../support/nitroGlobals'

installNitroGlobals()

const { assertSplitsBalance, setSplits, splitsForOne, derivedCategoryId, isSplit }
  = await import('../../server/services/finance/splits')
const { createAccount } = await import('../../server/services/finance/accounts')
const { createTransaction, listTransactions, patchTransaction, spendByCategory }
  = await import('../../server/services/finance/transactions')
const { budgetForMonth, setBudget } = await import('../../server/services/finance/budgets')
const { createRule, runRules } = await import('../../server/services/finance/rules')
const { deleteCategory } = await import('../../server/services/finance/categories')
const { createBill } = await import('../../server/services/finance/bills')
const { buildForecast } = await import('../../server/services/finance/overview')

let db: Db
let householdId: string
let profileId: string
let accountId: string
let groceries: string
let household: string
let utilities: string

beforeAll(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
})

beforeEach(() => {
  for (const table of [
    financeBills, financeBudgets, financeRules, financeTransactions,
    financeCategories, financeAccounts, financeConnections,
  ]) db.delete(table).run()
  db.delete(profiles).run()
  db.delete(households).run()

  householdId = db.insert(households).values({
    name: 'Betts', passwordHash: 'x', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get().id
  profileId = db.insert(profiles)
    .values({ householdId, name: 'Dad', color: '#112233', role: 'admin' })
    .returning().get().id
  accountId = createAccount(db, householdId, { name: 'Checking', type: 'checking', currency: 'USD' }).id

  const category = (name: string) => db.insert(financeCategories)
    .values({ householdId, name, kind: 'expense' }).returning().get().id
  groceries = category('Groceries')
  household = category('Household')
  utilities = category('Utilities')
})

function add(input: Parameters<typeof createTransaction>[1]['input']) {
  return createTransaction(db, { householdId, profileId, input })
}

const base = { accountId: '', postedDate: '2026-07-10', description: 'Costco' }

// ── The invariant ─────────────────────────────────────────────────────────

describe('the sum invariant', () => {
  it('accepts lines that add up exactly', () => {
    expect(() => assertSplitsBalance(
      [{ amountMinor: -4000 }, { amountMinor: -2040 }], -6040,
    )).not.toThrow()
  })

  it('rejects a set that is short, naming the difference', () => {
    expect(() => assertSplitsBalance([{ amountMinor: -4000 }], -6040))
      .toThrow(/-6040/)
  })

  it('rejects a set that overshoots', () => {
    expect(() => assertSplitsBalance([{ amountMinor: -4000 }, { amountMinor: -3000 }], -6040))
      .toThrow(/over by/)
  })

  it('rejects an empty set — a transaction always has at least one line', () => {
    expect(() => assertSplitsBalance([], -6040)).toThrow(/at least one/)
  })

  it('rejects a fractional amount', () => {
    expect(() => assertSplitsBalance([{ amountMinor: -6040.5 }], -6040.5))
      .toThrow(/whole minor units/)
  })

  /**
   * The case exact-sum alone would wave through: +1000 and -1050 balances a
   * -50 charge while both budget lines are wildly wrong.
   */
  it('rejects a line pointing the opposite way to the transaction', () => {
    expect(() => assertSplitsBalance(
      [{ amountMinor: 100_000 }, { amountMinor: -105_000 }], -5000,
    )).toThrow(/payment/)
    expect(() => assertSplitsBalance(
      [{ amountMinor: -100_000 }, { amountMinor: 105_000 }], 5000,
    )).toThrow(/deposit/)
  })

  it('splits a deposit into deposits', () => {
    expect(() => assertSplitsBalance(
      [{ amountMinor: 200_000 }, { amountMinor: 50_000 }], 250_000,
    )).not.toThrow()
  })

  it('replaces the whole set rather than appending', () => {
    const txn = add({ ...base, accountId, amountMinor: -6040, categoryId: groceries })
    setSplits(db, txn.id, -6040, [{ categoryId: groceries, amountMinor: -4000 }, { categoryId: household, amountMinor: -2040 }])
    setSplits(db, txn.id, -6040, [{ categoryId: groceries, amountMinor: -6040 }])
    expect(splitsForOne(db, txn.id)).toHaveLength(1)
  })

  it('leaves the previous set intact when the new one does not balance', () => {
    const txn = add({ ...base, accountId, amountMinor: -6040, categoryId: groceries })
    expect(() => setSplits(db, txn.id, -6040, [{ amountMinor: -10 }])).toThrow()
    const after = splitsForOne(db, txn.id)
    expect(after).toHaveLength(1)
    expect(after[0]!.amountMinor).toBe(-6040)
  })
})

// ── Creation ──────────────────────────────────────────────────────────────

describe('every transaction has splits', () => {
  it('gives an ordinary transaction exactly one line for the whole amount', () => {
    const txn = add({ ...base, accountId, amountMinor: -6040, categoryId: groceries })
    const splits = splitsForOne(db, txn.id)
    expect(splits).toHaveLength(1)
    expect(splits[0]!.amountMinor).toBe(-6040)
    expect(splits[0]!.categoryId).toBe(groceries)
    expect(isSplit(splits)).toBe(false)
    expect(derivedCategoryId(splits)).toBe(groceries)
  })

  it('accepts an explicit split at creation', () => {
    const txn = add({
      ...base,
      accountId,
      amountMinor: -6040,
      splits: [
        { categoryId: groceries, amountMinor: -4000, note: 'food' },
        { categoryId: household, amountMinor: -2040 },
      ],
    })
    const splits = splitsForOne(db, txn.id)
    expect(splits.map(s => s.amountMinor)).toEqual([-4000, -2040])
    expect(splits[0]!.note).toBe('food')
    expect(derivedCategoryId(splits)).toBeNull()
  })

  it('refuses a creation whose lines do not add up', () => {
    expect(() => add({
      ...base,
      accountId,
      amountMinor: -6040,
      splits: [{ categoryId: groceries, amountMinor: -4000 }],
    })).toThrow()
  })
})

// ── Editing ───────────────────────────────────────────────────────────────

describe('editing splits', () => {
  it('splits an existing transaction through PATCH', () => {
    const txn = add({ ...base, accountId, amountMinor: -6040, categoryId: groceries })
    patchTransaction(db, householdId, txn.id, {
      splits: [
        { categoryId: groceries, amountMinor: -4000 },
        { categoryId: household, amountMinor: -2040 },
      ],
    })
    expect(splitsForOne(db, txn.id)).toHaveLength(2)
  })

  it('un-splits when sent a single line', () => {
    const txn = add({
      ...base,
      accountId,
      amountMinor: -6040,
      splits: [{ categoryId: groceries, amountMinor: -4000 }, { categoryId: household, amountMinor: -2040 }],
    })
    patchTransaction(db, householdId, txn.id, { splits: [{ categoryId: groceries, amountMinor: -6040 }] })
    expect(derivedCategoryId(splitsForOne(db, txn.id))).toBe(groceries)
  })

  it('judges the lines against the amount AFTER the patch, not before', () => {
    const txn = add({ ...base, accountId, amountMinor: -6040, categoryId: groceries })
    patchTransaction(db, householdId, txn.id, {
      amountMinor: -8000,
      splits: [{ categoryId: groceries, amountMinor: -5000 }, { categoryId: household, amountMinor: -3000 }],
    })
    const splits = splitsForOne(db, txn.id)
    expect(splits.reduce((a, s) => a + s.amountMinor, 0)).toBe(-8000)
  })

  it('refuses to collapse a hand-made split with a bare categoryId', () => {
    const txn = add({
      ...base,
      accountId,
      amountMinor: -6040,
      splits: [{ categoryId: groceries, amountMinor: -4000 }, { categoryId: household, amountMinor: -2040 }],
    })
    expect(() => patchTransaction(db, householdId, txn.id, { categoryId: utilities }))
      .toThrow(/split across categories/)
    expect(splitsForOne(db, txn.id)).toHaveLength(2)
  })

  it('refuses an amount change that would strand a split', () => {
    const txn = add({
      ...base,
      accountId,
      amountMinor: -6040,
      splits: [{ categoryId: groceries, amountMinor: -4000 }, { categoryId: household, amountMinor: -2040 }],
    })
    expect(() => patchTransaction(db, householdId, txn.id, { amountMinor: -7000 }))
      .toThrow(/no longer add up/)
  })

  it('lets an unsplit transaction follow its amount', () => {
    const txn = add({ ...base, accountId, amountMinor: -6040, categoryId: groceries })
    patchTransaction(db, householdId, txn.id, { amountMinor: -7000 })
    const splits = splitsForOne(db, txn.id)
    expect(splits).toHaveLength(1)
    expect(splits[0]!.amountMinor).toBe(-7000)
    expect(splits[0]!.categoryId).toBe(groceries)
  })
})

// ── Aggregation ───────────────────────────────────────────────────────────

describe('spendByCategory', () => {
  it('reports the same totals as before for unsplit data', () => {
    add({ ...base, accountId, amountMinor: -4000, categoryId: groceries })
    add({ ...base, accountId, amountMinor: -2000, categoryId: groceries })
    add({ ...base, accountId, amountMinor: -1500, categoryId: household })

    const rows = spendByCategory(db, householdId, '2026-07-01', '2026-08-01')
    const byCategory = new Map(rows.map(r => [r.categoryId, r]))
    expect(byCategory.get(groceries)).toMatchObject({ totalMinor: -6000, n: 2, currency: 'USD' })
    expect(byCategory.get(household)).toMatchObject({ totalMinor: -1500, n: 1 })
  })

  it('lands each part of a split in its own category', () => {
    add({
      ...base,
      accountId,
      amountMinor: -6040,
      splits: [{ categoryId: groceries, amountMinor: -4000 }, { categoryId: household, amountMinor: -2040 }],
    })
    const byCategory = new Map(
      spendByCategory(db, householdId, '2026-07-01', '2026-08-01').map(r => [r.categoryId, r]),
    )
    expect(byCategory.get(groceries)!.totalMinor).toBe(-4000)
    expect(byCategory.get(household)!.totalMinor).toBe(-2040)
  })

  /**
   * There is deliberately no unique index on (transaction, category), so two
   * lines can share one. count(*) would call that two transactions.
   */
  it('counts a transaction once even with two lines in one category', () => {
    add({
      ...base,
      accountId,
      amountMinor: -6040,
      splits: [
        { categoryId: groceries, amountMinor: -4000, note: 'food' },
        { categoryId: groceries, amountMinor: -2040, note: 'wine' },
      ],
    })
    const row = spendByCategory(db, householdId, '2026-07-01', '2026-08-01')
      .find(r => r.categoryId === groceries)!
    expect(row.totalMinor).toBe(-6040)
    expect(row.n).toBe(1)
  })

  it('keeps the uncategorised part of a split uncategorised', () => {
    add({
      ...base,
      accountId,
      amountMinor: -6040,
      splits: [{ categoryId: groceries, amountMinor: -4000 }, { amountMinor: -2040 }],
    })
    const row = spendByCategory(db, householdId, '2026-07-01', '2026-08-01')
      .find(r => r.categoryId === null)!
    expect(row.totalMinor).toBe(-2040)
  })
})

describe('budgets see the split parts', () => {
  it('moves two budget lines from one receipt', () => {
    setBudget(db, householdId, { periodStart: '2026-07', categoryId: groceries, amountMinor: 50_000, rollover: false, currency: 'USD' })
    setBudget(db, householdId, { periodStart: '2026-07', categoryId: household, amountMinor: 20_000, rollover: false, currency: 'USD' })
    add({
      ...base,
      accountId,
      amountMinor: -6040,
      splits: [{ categoryId: groceries, amountMinor: -4000 }, { categoryId: household, amountMinor: -2040 }],
    })

    const budget = budgetForMonth(db, householdId, '2026-07', 'USD')
    const line = (id: string) => budget.lines.find(l => l.categoryId === id)!
    expect(line(groceries).spentMinor).toBe(4000)
    expect(line(household).spentMinor).toBe(2040)
    expect(budget.totalSpentMinor).toBe(6040)
  })
})

// ── Listing ───────────────────────────────────────────────────────────────

describe('the ledger', () => {
  it('matches a transaction with any line in the filtered category', () => {
    add({
      ...base,
      accountId,
      amountMinor: -6040,
      splits: [{ categoryId: groceries, amountMinor: -4000 }, { categoryId: household, amountMinor: -2040 }],
    })
    const found = listTransactions(db, householdId, { categoryId: household, limit: 50, offset: 0 })
    expect(found.total).toBe(1)
    expect(found.items[0]!.isSplit).toBe(true)
    expect(found.items[0]!.categoryId).toBeNull()
  })

  it('flags a transaction with an uncategorised line as needing a category', () => {
    add({
      ...base,
      accountId,
      amountMinor: -6040,
      splits: [{ categoryId: groceries, amountMinor: -4000 }, { amountMinor: -2040 }],
    })
    expect(listTransactions(db, householdId, { uncategorized: true, limit: 50, offset: 0 }).total).toBe(1)
  })

  it('keeps categoryId working for the ordinary single-line case', () => {
    add({ ...base, accountId, amountMinor: -4000, categoryId: groceries })
    const item = listTransactions(db, householdId, { limit: 50, offset: 0 }).items[0]!
    expect(item.categoryId).toBe(groceries)
    expect(item.categoryName).toBe('Groceries')
    expect(item.isSplit).toBe(false)
  })

  it('returns the lines in the order they were authored', () => {
    add({
      ...base,
      accountId,
      amountMinor: -6040,
      splits: [{ categoryId: household, amountMinor: -2040 }, { categoryId: groceries, amountMinor: -4000 }],
    })
    const item = listTransactions(db, householdId, { limit: 50, offset: 0 }).items[0]!
    expect(item.splits.map(s => s.categoryId)).toEqual([household, groceries])
  })
})

// ── Rules ─────────────────────────────────────────────────────────────────

describe('rules and hand-made splits', () => {
  beforeEach(() => {
    createRule(db, householdId, {
      matchField: 'description', matchType: 'contains', matchValue: 'costco',
      setCategoryId: utilities, priority: 0, enabled: true,
    })
  })

  it('still categorises an ordinary uncategorised transaction', () => {
    add({ ...base, accountId, amountMinor: -4000, description: 'COSTCO WHOLESALE' })
    // The rule already fires on create, so re-running it changes nothing —
    // clear the line first to prove the sweep itself does the work.
    const txn = listTransactions(db, householdId, { limit: 1, offset: 0 }).items[0]!
    db.update(financeTransactionSplits)
      .set({ categoryId: null, categorizedBy: null })
      .where(eq(financeTransactionSplits.transactionId, txn.id)).run()

    expect(runRules(db, householdId, { onlyUncategorized: true }).updated).toBe(1)
    expect(derivedCategoryId(splitsForOne(db, txn.id))).toBe(utilities)
  })

  it('never touches a transaction somebody split by hand', () => {
    const txn = add({
      ...base,
      accountId,
      amountMinor: -6040,
      description: 'COSTCO WHOLESALE',
      splits: [{ categoryId: groceries, amountMinor: -4000 }, { amountMinor: -2040 }],
    })
    expect(runRules(db, householdId, { onlyUncategorized: false }).updated).toBe(0)
    const splits = splitsForOne(db, txn.id)
    expect(splits.map(s => s.categoryId)).toEqual([groceries, null])
  })

  it('leaves a hand-chosen category alone', () => {
    const txn = add({ ...base, accountId, amountMinor: -4000, description: 'COSTCO', categoryId: groceries })
    runRules(db, householdId, { onlyUncategorized: false })
    expect(derivedCategoryId(splitsForOne(db, txn.id))).toBe(groceries)
  })
})

// ── Categories ────────────────────────────────────────────────────────────

describe('deleting a category', () => {
  it('archives it when a split line references it', () => {
    add({
      ...base,
      accountId,
      amountMinor: -6040,
      splits: [{ categoryId: groceries, amountMinor: -4000 }, { categoryId: household, amountMinor: -2040 }],
    })
    expect(deleteCategory(db, householdId, household)).toEqual({ archived: true })
    const row = db.select().from(financeCategories).where(eq(financeCategories.id, household)).get()
    expect(row?.archivedAt).toBeTruthy()
  })

  it('deletes one nothing references', () => {
    expect(deleteCategory(db, householdId, utilities)).toEqual({ archived: false })
  })
})

// ── Cascade ───────────────────────────────────────────────────────────────

describe('deleting a transaction', () => {
  it('takes its splits with it', () => {
    const txn = add({
      ...base,
      accountId,
      amountMinor: -6040,
      splits: [{ categoryId: groceries, amountMinor: -4000 }, { categoryId: household, amountMinor: -2040 }],
    })
    db.delete(financeTransactions).where(eq(financeTransactions.id, txn.id)).run()
    const left = db.select().from(financeTransactionSplits)
      .where(and(eq(financeTransactionSplits.transactionId, txn.id))).all()
    expect(left).toEqual([])
  })
})

// ── The discretionary average ─────────────────────────────────────────────

/**
 * The forecast subtracts bills as explicit occurrences, so their spend must
 * not also land in the everyday average — the exclusion works by category.
 * With splits that exclusion has to operate on the LINE, or one small utility
 * line on a grocery receipt throws away the groceries too.
 */
describe('the bill-category exclusion', () => {
  const day = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() - offset)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  function forecastWith(splits: { categoryId?: string | null, amountMinor: number }[]) {
    createBill(db, householdId, {
      name: 'Electric', kind: 'expense', amountMinor: 12_000, currency: 'USD',
      categoryId: utilities, rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', startDate: day(60),
    })
    add({ ...base, accountId, postedDate: day(3), amountMinor: -18_000, splits })
    return buildForecast(db, householdId, { currency: 'USD', currencyExponent: 2, days: 30 })
  }

  it('drops only the line in the bill category, not the whole receipt', () => {
    const split = forecastWith([
      { categoryId: groceries, amountMinor: -16_000 },
      { categoryId: utilities, amountMinor: -2000 },
    ])
    // £160 of groceries survives, so the projection still falls day by day.
    const perDay = split.days[0]!.discretionaryMinor
    expect(perDay).toBeGreaterThan(0)

    // And it is the £160, not the £180. Divided by the 14-day floor, because
    // three days of history is all this household has.
    expect(perDay).toBe(Math.round(16_000 / 14))
  })

  it('still drops a receipt that is entirely a bill category', () => {
    const all = forecastWith([{ categoryId: utilities, amountMinor: -18_000 }])
    expect(all.days[0]!.discretionaryMinor).toBe(0)
  })
})
