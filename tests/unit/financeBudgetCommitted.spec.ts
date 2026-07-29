import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings, financeAccounts, financeBillPayments, financeBills,
  financeBudgets, financeCategories, financeTransactions, households, profiles,
} from '../../server/db/schema'
import { installNitroGlobals } from '../support/nitroGlobals'

installNitroGlobals()

const { budgetForMonth, setBudget } = await import('../../server/services/finance/budgets')
const { createBill, markBillOccurrence } = await import('../../server/services/finance/bills')
const { createAccount } = await import('../../server/services/finance/accounts')
const { createTransaction } = await import('../../server/services/finance/transactions')

/**
 * Unpaid bills reserve their category's budget. Everything here uses a fixed
 * period so it never depends on the wall clock.
 */
const PERIOD = '2026-08'
const DUE = '2026-08-10'

let db: Db
let householdId: string
let profileId: string
let accountId: string
let housing: string
let food: string

beforeAll(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
})

beforeEach(() => {
  for (const table of [financeBillPayments, financeBills, financeBudgets, financeTransactions, financeCategories, financeAccounts])
    db.delete(table).run()
  db.delete(profiles).run()
  db.delete(households).run()

  householdId = db.insert(households).values({
    name: 'Betts', passwordHash: 'x', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get().id
  profileId = db.insert(profiles)
    .values({ householdId, name: 'Dad', color: '#112233', role: 'admin' })
    .returning().get().id
  accountId = createAccount(db, householdId, { name: 'Checking', currency: 'USD' }).id
  housing = category('Housing')
  food = category('Food')
})

function category(name: string) {
  return db.insert(financeCategories).values({ householdId, name, kind: 'expense' }).returning().get().id
}
function budget(categoryId: string, amountMinor: number) {
  setBudget(db, householdId, { categoryId, periodStart: PERIOD, amountMinor, rollover: false, currency: 'USD' })
}
function bill(input: Record<string, unknown>) {
  return createBill(db, householdId, { currency: 'USD', rrule: null, startDate: DUE, autoPay: false, ...input })
}
function spend(categoryId: string, amountMinor: number) {
  return createTransaction(db, { householdId, profileId, input: { accountId, postedDate: DUE, description: 'x', amountMinor, categoryId } })
}
function lineFor(categoryId: string) {
  return budgetForMonth(db, householdId, PERIOD, 'USD').lines.find(l => l.categoryId === categoryId)!
}

describe('unpaid bills reserve a budget', () => {
  it('an unpaid expense bill reserves the category and cuts available', () => {
    budget(housing, 200000)
    bill({ name: 'Rent', kind: 'expense', amountMinor: 120000, categoryId: housing })

    const res = budgetForMonth(db, householdId, PERIOD, 'USD')
    const l = res.lines.find(x => x.categoryId === housing)!
    expect(l.committedMinor).toBe(120000)
    expect(l.spentMinor).toBe(0)
    expect(l.remainingMinor).toBe(80000) // 200000 − 0 spent − 120000 reserved
    expect(l.progress).toBe(0) // fill is real spend only
    expect(res.totalCommittedMinor).toBe(120000)
  })

  it('spending plus a reservation can push a category over budget', () => {
    budget(housing, 100000)
    spend(housing, -70000)
    bill({ name: 'Rent', kind: 'expense', amountMinor: 50000, categoryId: housing })

    const l = lineFor(housing)
    expect(l.spentMinor).toBe(70000)
    expect(l.committedMinor).toBe(50000)
    expect(l.remainingMinor).toBe(-20000) // client shows "over by"
  })

  it('a paid bill is not double-counted — its real spend comes through the transaction', () => {
    budget(housing, 200000)
    const b = bill({ name: 'Rent', kind: 'expense', amountMinor: 120000, categoryId: housing })
    const t = spend(housing, -120000)
    markBillOccurrence(db, householdId, b.id, { dueDate: DUE, status: 'paid', transactionId: t.id })

    const l = lineFor(housing)
    expect(l.committedMinor).toBe(0)
    expect(l.spentMinor).toBe(120000)
  })

  it('a skipped bill reserves nothing', () => {
    budget(housing, 200000)
    const b = bill({ name: 'Rent', kind: 'expense', amountMinor: 120000, categoryId: housing })
    markBillOccurrence(db, householdId, b.id, { dueDate: DUE, status: 'skipped' })
    expect(lineFor(housing).committedMinor).toBe(0)
  })

  it('an income bill never reserves an expense budget', () => {
    budget(housing, 200000)
    bill({ name: 'Rebate', kind: 'income', amountMinor: 50000, categoryId: housing })
    expect(lineFor(housing).committedMinor).toBe(0)
  })

  it('a bill in another currency is ignored', () => {
    budget(housing, 200000)
    bill({ name: 'Rent', kind: 'expense', amountMinor: 50000, categoryId: housing, currency: 'EUR' })
    expect(lineFor(housing).committedMinor).toBe(0)
  })

  it('reserves even a category with no budget set', () => {
    bill({ name: 'Groceries', kind: 'expense', amountMinor: 30000, categoryId: food })
    const l = lineFor(food)
    expect(l.amountMinor).toBe(0)
    expect(l.committedMinor).toBe(30000)
    expect(l.remainingMinor).toBe(-30000)
    expect(l.progress).toBeNull()
  })

  it('an uncategorized bill is reserved against nothing', () => {
    budget(housing, 200000)
    bill({ name: 'Mystery', kind: 'expense', amountMinor: 40000, categoryId: null })
    const res = budgetForMonth(db, householdId, PERIOD, 'USD')
    expect(res.totalCommittedMinor).toBe(0)
    expect(res.lines.every(l => l.committedMinor === 0)).toBe(true)
  })
})
