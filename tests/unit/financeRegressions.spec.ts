import { hash } from '@node-rs/argon2'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings, financeAccounts, financeBills, financeBudgets,
  financeCategories, financeConnections, financeMembers, financeSessions,
  financeTransactions, households, profiles,
} from '../../server/db/schema'
import { installNitroGlobals, makeEvent } from '../support/nitroGlobals'

installNitroGlobals()

const { setOwnFinancePin, unlockFinance } = await import('../../server/services/finance/access')
const { budgetForMonth, carryForwardBudgets, setBudget } = await import('../../server/services/finance/budgets')
const { createAccount } = await import('../../server/services/finance/accounts')
const { createTransaction } = await import('../../server/services/finance/transactions')
const { buildForecast } = await import('../../server/services/finance/overview')

let db: Db
let householdId: string
let dad: string

const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 }

beforeAll(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
})

beforeEach(() => {
  for (const table of [
    financeTransactions, financeBills, financeBudgets, financeCategories,
    financeSessions, financeMembers, financeAccounts, financeConnections,
  ]) db.delete(table).run()
  db.delete(profiles).run()
  db.delete(households).run()

  householdId = db.insert(households).values({
    name: 'Betts', passwordHash: 'x', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get().id
  dad = db.insert(profiles)
    .values({ householdId, name: 'Dad', color: '#112233', role: 'admin' })
    .returning().get().id
})

const sessionFor = (profileId: string) =>
  makeEvent({ user: { unlocked: true, householdId, profileId, role: 'admin' } })

describe('the PIN-change route is rate-limited like the unlock route', () => {
  it('counts a wrong current PIN and eventually locks out', async () => {
    await db.update(profiles).set({ pinHash: await hash('rightpin', ARGON) }).where(eq(profiles.id, dad)).run()
    db.insert(financeMembers).values({ profileId: dad, householdId, role: 'owner' }).run()
    const event = sessionFor(dad)

    // Without this, the PIN-change route is a free guessing oracle for the
    // same secret the unlock route meters.
    for (let i = 0; i < 5; i++) {
      await expect(setOwnFinancePin(event, { pin: 'brandnew', currentPin: 'wrong' }))
        .rejects.toMatchObject({ statusCode: 401 })
    }
    const member = db.select().from(financeMembers).where(eq(financeMembers.profileId, dad)).get()!
    expect(member.failedAttempts).toBe(5)
    expect(member.lockedUntil).not.toBeNull()

    await expect(setOwnFinancePin(event, { pin: 'brandnew', currentPin: 'rightpin' }))
      .rejects.toMatchObject({ statusCode: 429 })
  })

  it('shares the lockout with the unlock route rather than keeping its own', async () => {
    await db.update(profiles).set({ pinHash: await hash('rightpin', ARGON) }).where(eq(profiles.id, dad)).run()
    db.insert(financeMembers).values({ profileId: dad, householdId, role: 'owner' }).run()
    const event = sessionFor(dad)

    for (let i = 0; i < 5; i++) {
      await expect(setOwnFinancePin(event, { pin: 'brandnew', currentPin: 'wrong' })).rejects.toThrow()
    }
    await expect(unlockFinance(event, { pin: 'rightpin' })).rejects.toMatchObject({ statusCode: 429 })
  })
})

describe('budgets', () => {
  let groceries: string

  beforeEach(() => {
    groceries = db.insert(financeCategories)
      .values({ householdId, name: 'Groceries', kind: 'expense' }).returning().get().id
  })

  it('keeps an archived category’s spend in the month’s total', () => {
    const accountId = createAccount(db, householdId, { name: 'Checking' }).id
    createTransaction(db, {
      householdId,
      profileId: dad,
      input: { accountId, postedDate: '2026-07-05', amountMinor: -4500, description: 'shop', categoryId: groceries },
    })
    const before = budgetForMonth(db, householdId, '2026-07', 'USD')
    expect(before.totalSpentMinor).toBe(4500)

    // Archiving hides a category from the picker. It must not retroactively
    // subtract its spend, or the headline stops matching the ledger.
    db.update(financeCategories).set({ archivedAt: new Date() })
      .where(eq(financeCategories.id, groceries)).run()

    const after = budgetForMonth(db, householdId, '2026-07', 'USD')
    expect(after.totalSpentMinor).toBe(4500)
    expect(after.lines.find(l => l.categoryId === groceries)).toBeTruthy()
  })

  it('leaves an archived category out of months it was never used in', () => {
    db.update(financeCategories).set({ archivedAt: new Date() })
      .where(eq(financeCategories.id, groceries)).run()
    const empty = budgetForMonth(db, householdId, '2026-09', 'USD')
    expect(empty.lines.find(l => l.categoryId === groceries)).toBeFalsy()
  })

  it('carry-forward still only fills gaps', () => {
    setBudget(db, householdId, { categoryId: groceries, periodStart: '2026-06', amountMinor: 50000, rollover: false, currency: 'USD' })
    expect(carryForwardBudgets(db, householdId, '2026-07')).toBe(1)
    expect(carryForwardBudgets(db, householdId, '2026-07')).toBe(0)
  })
})

describe('the forecast', () => {
  it('does not subtract credit-card spend from the cash balance', () => {
    // Card spend is drawn on a credit line and reaches cash later as the
    // card-payment bill, which the forecast models separately. Counting the
    // raw card transactions too subtracts the same money twice, and the
    // projection walks steadily and wrongly downwards.
    const checking = createAccount(db, householdId, { name: 'Checking', type: 'checking', openingBalanceMinor: 500000 }).id
    const card = createAccount(db, householdId, { name: 'Visa', type: 'credit' }).id

    const today = new Date()
    const day = (offset: number) => {
      const d = new Date(today)
      d.setDate(d.getDate() - offset)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    for (let i = 1; i <= 30; i++) {
      createTransaction(db, {
        householdId,
        profileId: dad,
        input: { accountId: card, postedDate: day(i), amountMinor: -10000, description: 'card spend' },
      })
    }

    const withCardOnly = buildForecast(db, householdId, { currency: 'USD', currencyExponent: 2, days: 30 })
    // Nothing was ever spent from the cash accounts, so there is no everyday
    // spend to project and the balance holds flat.
    expect(withCardOnly.openingBalanceMinor).toBe(500000)
    expect(withCardOnly.endingBalanceMinor).toBe(500000)

    // Cash spending, by contrast, must still be picked up.
    createTransaction(db, {
      householdId,
      profileId: dad,
      input: { accountId: checking, postedDate: day(1), amountMinor: -9000, description: 'groceries' },
    })
    const withCash = buildForecast(db, householdId, { currency: 'USD', currencyExponent: 2, days: 30 })
    expect(withCash.endingBalanceMinor).toBeLessThan(500000)
  })

  it('counts only spendable accounts in the opening balance', () => {
    createAccount(db, householdId, { name: 'Checking', type: 'checking', openingBalanceMinor: 100000 })
    createAccount(db, householdId, { name: 'Savings', type: 'savings', openingBalanceMinor: 250000 })
    createAccount(db, householdId, { name: 'Visa', type: 'credit', openingBalanceMinor: -80000 })
    createAccount(db, householdId, { name: '401k', type: 'investment', openingBalanceMinor: 9_000_000 })

    const forecast = buildForecast(db, householdId, { currency: 'USD', currencyExponent: 2, days: 30 })
    // Cash + savings only: a credit limit is not money, and a retirement
    // account is not this month's rent.
    expect(forecast.openingBalanceMinor).toBe(350000)
  })
})

describe('manual accounts', () => {
  it('are created in the currency they were asked for, not USD', () => {
    const account = createAccount(db, householdId, { name: 'Yen', currency: 'JPY', openingBalanceMinor: 1000 })
    expect(account.currency).toBe('JPY')
    // Zero-decimal: ¥1000 is 1000 minor units, not 100000.
    expect(account.currencyExponent).toBe(0)
    expect(account.balanceMinor).toBe(1000)
  })
})
