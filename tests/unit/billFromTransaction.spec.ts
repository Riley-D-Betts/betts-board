import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { billSeedFromTransaction } from '../../shared/utils/billFromTransaction'
import { createDb, setDb, type Db } from '../../server/db/client'
import { defaultHouseholdSettings, financeAccounts, financeBills, financeCategories, households, profiles } from '../../server/db/schema'
import { installNitroGlobals } from '../support/nitroGlobals'

installNitroGlobals()

const { createAccount } = await import('../../server/services/finance/accounts')
const { createCategory } = await import('../../server/services/finance/categories')
const { createBill, expandBills } = await import('../../server/services/finance/bills')

// ── The pure mapping ────────────────────────────────────────────────────────

describe('billSeedFromTransaction', () => {
  const base = { description: 'Rent', amountMinor: -120000, postedDate: '2026-03-01', categoryId: 'cat-1', accountId: 'acc-1' }

  it('maps a spend: sign becomes kind, amount becomes positive', () => {
    expect(billSeedFromTransaction(base)).toEqual({
      name: 'Rent', kind: 'expense', amountMinor: 120000,
      startDate: '2026-03-01', categoryId: 'cat-1', accountId: 'acc-1',
    })
  })

  it('maps a positive amount to income', () => {
    expect(billSeedFromTransaction({ ...base, amountMinor: 250000 }).kind).toBe('income')
  })

  it('treats a zero amount as an expense', () => {
    expect(billSeedFromTransaction({ ...base, amountMinor: 0 }).kind).toBe('expense')
  })

  it('carries a split transaction through as uncategorized', () => {
    expect(billSeedFromTransaction({ ...base, categoryId: null }).categoryId).toBeNull()
  })

  it('caps the name at the 80-char bill limit', () => {
    const long = 'x'.repeat(200)
    expect(billSeedFromTransaction({ ...base, description: long }).name).toHaveLength(80)
  })

  it('trims before it caps, and keeps the posted date verbatim', () => {
    const seed = billSeedFromTransaction({ ...base, description: '  Water bill  ' })
    expect(seed.name).toBe('Water bill')
    expect(seed.startDate).toBe('2026-03-01')
  })
})

// ── End to end: the mapped seed makes a real, expandable bill ────────────────

let db: Db
let householdId: string

beforeAll(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
})

beforeEach(() => {
  for (const table of [financeBills, financeCategories, financeAccounts]) db.delete(table).run()
  db.delete(profiles).run()
  db.delete(households).run()
  householdId = db.insert(households).values({
    name: 'Betts', passwordHash: 'x', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get().id
})

describe('a bill made from a transaction', () => {
  it('stores the mapped kind/amount and expands monthly from the posted date', () => {
    const account = createAccount(db, householdId, { name: 'Checking', currency: 'USD' })
    const category = createCategory(db, householdId, { name: 'Housing' })

    const seed = billSeedFromTransaction({
      description: 'Rent', amountMinor: -120000, postedDate: '2026-01-15',
      categoryId: category.id, accountId: account.id,
    })
    createBill(db, householdId, { ...seed, rrule: 'FREQ=MONTHLY' })

    const occurrences = expandBills(db, householdId, '2026-01-01', '2026-04-01')
    expect(occurrences.map(o => o.dueDate)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15'])
    expect(occurrences[0]!.kind).toBe('expense')
    expect(occurrences[0]!.amountMinor).toBe(120000)
  })

  it('a one-off (rrule null) yields exactly the posted date', () => {
    const account = createAccount(db, householdId, { name: 'Checking', currency: 'USD' })
    const seed = billSeedFromTransaction({
      description: 'Annual fee', amountMinor: -5000, postedDate: '2026-02-10',
      categoryId: null, accountId: account.id,
    })
    createBill(db, householdId, { ...seed, rrule: null })

    expect(expandBills(db, householdId, '2026-01-01', '2026-06-01').map(o => o.dueDate))
      .toEqual(['2026-02-10'])
  })
})
