import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings, financeAccounts, financeBillPayments, financeBills,
  financeBudgets, financeCategories, financeConnections, financeGoalContributions,
  financeGoals, financeImportBatches, financeTransactions, households, profiles,
} from '../../server/db/schema'
import { installNitroGlobals } from '../support/nitroGlobals'
import { projectCashFlow, averageDailySpend } from '../../server/services/finance/forecast'
import type { BillOccurrence } from '../../server/services/finance/bills'

installNitroGlobals()

const { budgetForMonth, carryForwardBudgets, monthWindow, previousMonth, setBudget }
  = await import('../../server/services/finance/budgets')
const { createBill, expandBills, markBillOccurrence, clearBillOccurrence }
  = await import('../../server/services/finance/bills')
const { contributeToGoal, createGoal, listGoals } = await import('../../server/services/finance/goals')
const { createAccount } = await import('../../server/services/finance/accounts')
const { createTransaction } = await import('../../server/services/finance/transactions')

let db: Db
let householdId: string
let profileId: string
let groceries: string

beforeAll(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
})

beforeEach(() => {
  // Children before parents — foreign keys are ON in createDb().
  for (const table of [
    financeBillPayments, financeBills, financeBudgets, financeGoalContributions,
    financeGoals, financeTransactions, financeCategories, financeImportBatches,
    financeAccounts, financeConnections,
  ]) db.delete(table).run()
  db.delete(profiles).run()
  db.delete(households).run()

  const hh = db.insert(households).values({
    name: 'Betts', passwordHash: 'x', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get()
  householdId = hh.id
  profileId = db.insert(profiles)
    .values({ householdId, name: 'Dad', color: '#112233', role: 'admin' })
    .returning().get().id
  groceries = db.insert(financeCategories)
    .values({ householdId, name: 'Groceries', kind: 'expense' }).returning().get().id
})

// ── Budgets ───────────────────────────────────────────────────────────────

describe('month arithmetic', () => {
  it.each([
    ['2026-01', { start: '2026-01-01', end: '2026-02-01' }],
    ['2026-12', { start: '2026-12-01', end: '2027-01-01' }],
    ['2026-02', { start: '2026-02-01', end: '2026-03-01' }],
  ])('%s spans %o', (period, expected) => {
    expect(monthWindow(period)).toEqual(expected)
  })

  it('rolls the year backwards in January', () => {
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(previousMonth('2026-07')).toBe('2026-06')
  })
})

describe('budgetForMonth', () => {
  function spend(amountMinor: number, postedDate: string, categoryId: string | null = groceries) {
    const accountId = createAccount(db, householdId, { name: 'Checking' }).id
    createTransaction(db, {
      householdId,
      profileId,
      input: { accountId, postedDate, amountMinor, description: 'shop', categoryId },
    })
  }

  it('derives spend from transactions rather than a stored total', () => {
    setBudget(db, householdId, { categoryId: groceries, periodStart: '2026-07', amountMinor: 60000, rollover: false, currency: 'USD' })
    spend(-12000, '2026-07-03')
    spend(-8000, '2026-07-19')

    const line = budgetForMonth(db, householdId, '2026-07', 'USD').lines.find(l => l.categoryId === groceries)!
    expect(line.spentMinor).toBe(20000)
    expect(line.remainingMinor).toBe(40000)
    expect(line.progress).toBeCloseTo(1 / 3)
  })

  it('counts only the month asked for — a half-open window', () => {
    setBudget(db, householdId, { categoryId: groceries, periodStart: '2026-07', amountMinor: 60000, rollover: false, currency: 'USD' })
    spend(-5000, '2026-06-30')
    spend(-7000, '2026-07-01')
    spend(-9000, '2026-08-01')

    const line = budgetForMonth(db, householdId, '2026-07', 'USD').lines.find(l => l.categoryId === groceries)!
    expect(line.spentMinor).toBe(7000)
  })

  it('ignores income when totalling spend against an expense budget', () => {
    setBudget(db, householdId, { categoryId: groceries, periodStart: '2026-07', amountMinor: 60000, rollover: false, currency: 'USD' })
    spend(-10000, '2026-07-05')
    spend(4000, '2026-07-06') // a refund

    const line = budgetForMonth(db, householdId, '2026-07', 'USD').lines.find(l => l.categoryId === groceries)!
    // Net, because the refund genuinely reduces what was spent.
    expect(line.spentMinor).toBe(6000)
  })

  it('surfaces uncategorised spend rather than hiding it', () => {
    spend(-3300, '2026-07-08', null)
    expect(budgetForMonth(db, householdId, '2026-07', 'USD').uncategorizedMinor).toBe(3300)
  })

  it('reports no progress bar when no budget is set, rather than 0%', () => {
    const line = budgetForMonth(db, householdId, '2026-07', 'USD').lines.find(l => l.categoryId === groceries)!
    expect(line.progress).toBeNull()
  })
})

describe('carryForwardBudgets', () => {
  it('copies last month forward so the screen is not empty on the 1st', () => {
    setBudget(db, householdId, { categoryId: groceries, periodStart: '2026-06', amountMinor: 50000, rollover: false, currency: 'USD' })
    expect(carryForwardBudgets(db, householdId, '2026-07')).toBe(1)

    const line = budgetForMonth(db, householdId, '2026-07', 'USD').lines.find(l => l.categoryId === groceries)!
    expect(line.amountMinor).toBe(50000)
  })

  it('never overwrites an amount already set for this month', () => {
    setBudget(db, householdId, { categoryId: groceries, periodStart: '2026-06', amountMinor: 50000, rollover: false, currency: 'USD' })
    setBudget(db, householdId, { categoryId: groceries, periodStart: '2026-07', amountMinor: 30000, rollover: false, currency: 'USD' })
    expect(carryForwardBudgets(db, householdId, '2026-07')).toBe(0)

    const line = budgetForMonth(db, householdId, '2026-07', 'USD').lines.find(l => l.categoryId === groceries)!
    expect(line.amountMinor).toBe(30000)
  })

  it('is idempotent — running it twice does not duplicate rows', () => {
    setBudget(db, householdId, { categoryId: groceries, periodStart: '2026-06', amountMinor: 50000, rollover: false, currency: 'USD' })
    carryForwardBudgets(db, householdId, '2026-07')
    expect(carryForwardBudgets(db, householdId, '2026-07')).toBe(0)
    expect(db.select().from(financeBudgets).all()).toHaveLength(2)
  })

  it('editing one month leaves the other alone', () => {
    setBudget(db, householdId, { categoryId: groceries, periodStart: '2026-06', amountMinor: 50000, rollover: false, currency: 'USD' })
    setBudget(db, householdId, { categoryId: groceries, periodStart: '2026-07', amountMinor: 90000, rollover: false, currency: 'USD' })

    expect(budgetForMonth(db, householdId, '2026-06', 'USD').lines.find(l => l.categoryId === groceries)!.amountMinor).toBe(50000)
    expect(budgetForMonth(db, householdId, '2026-07', 'USD').lines.find(l => l.categoryId === groceries)!.amountMinor).toBe(90000)
  })
})

// ── Bills ─────────────────────────────────────────────────────────────────

describe('expandBills', () => {
  it('expands a monthly bill across a window', () => {
    createBill(db, householdId, {
      name: 'Rent', kind: 'expense', amountMinor: 125000, currency: 'USD',
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', startDate: '2026-01-01',
    })
    const dates = expandBills(db, householdId, '2026-01-01', '2026-04-01').map(o => o.dueDate)
    expect(dates).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
  })

  it('handles the classic: monthly on the 31st across February', () => {
    createBill(db, householdId, {
      name: 'Card', kind: 'expense', amountMinor: 5000, currency: 'USD',
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=31', startDate: '2026-01-31',
    })
    const dates = expandBills(db, householdId, '2026-01-01', '2026-05-01').map(o => o.dueDate)
    // February simply has no 31st — it is skipped, not clamped to the 28th.
    expect(dates).toEqual(['2026-01-31', '2026-03-31'])
  })

  it('respects the window as half-open', () => {
    createBill(db, householdId, {
      name: 'Rent', kind: 'expense', amountMinor: 125000, currency: 'USD',
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', startDate: '2026-01-01',
    })
    expect(expandBills(db, householdId, '2026-01-01', '2026-02-01').map(o => o.dueDate))
      .toEqual(['2026-01-01'])
  })

  it('stops at recurrenceEnd', () => {
    createBill(db, householdId, {
      name: 'Gym', kind: 'expense', amountMinor: 3000, currency: 'USD',
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=5', startDate: '2026-01-05', recurrenceEnd: '2026-02-28',
    })
    expect(expandBills(db, householdId, '2026-01-01', '2026-06-01').map(o => o.dueDate))
      .toEqual(['2026-01-05', '2026-02-05'])
  })

  it('emits a one-off bill exactly once', () => {
    createBill(db, householdId, {
      name: 'Car tax', kind: 'expense', amountMinor: 21000, currency: 'USD',
      rrule: null, startDate: '2026-03-14',
    })
    expect(expandBills(db, householdId, '2026-01-01', '2026-06-01').map(o => o.dueDate))
      .toEqual(['2026-03-14'])
  })

  it('materialises a row only when somebody marks an occurrence', () => {
    const bill = createBill(db, householdId, {
      name: 'Rent', kind: 'expense', amountMinor: 125000, currency: 'USD',
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', startDate: '2026-01-01',
    })
    expect(db.select().from(financeBillPayments).all()).toHaveLength(0)

    markBillOccurrence(db, householdId, bill.id, { dueDate: '2026-02-01', status: 'paid' })
    expect(db.select().from(financeBillPayments).all()).toHaveLength(1)

    const occurrences = expandBills(db, householdId, '2026-01-01', '2026-04-01')
    expect(occurrences.find(o => o.dueDate === '2026-02-01')!.status).toBe('paid')
    expect(occurrences.find(o => o.dueDate === '2026-01-01')!.status).toBe('due')
  })

  it('goes back to due by deleting the override, not storing a third state', () => {
    const bill = createBill(db, householdId, {
      name: 'Rent', kind: 'expense', amountMinor: 125000, currency: 'USD',
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', startDate: '2026-01-01',
    })
    markBillOccurrence(db, householdId, bill.id, { dueDate: '2026-02-01', status: 'skipped' })
    clearBillOccurrence(db, householdId, bill.id, '2026-02-01')

    expect(db.select().from(financeBillPayments).all()).toHaveLength(0)
    expect(expandBills(db, householdId, '2026-01-01', '2026-04-01')
      .find(o => o.dueDate === '2026-02-01')!.status).toBe('due')
  })

  it('marking the same occurrence twice updates rather than duplicates', () => {
    const bill = createBill(db, householdId, {
      name: 'Rent', kind: 'expense', amountMinor: 125000, currency: 'USD',
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', startDate: '2026-01-01',
    })
    markBillOccurrence(db, householdId, bill.id, { dueDate: '2026-02-01', status: 'paid' })
    markBillOccurrence(db, householdId, bill.id, { dueDate: '2026-02-01', status: 'skipped' })
    expect(db.select().from(financeBillPayments).all()).toHaveLength(1)
  })
})

// ── Goals ─────────────────────────────────────────────────────────────────

describe('goals', () => {
  it('tracks progress from the manual ledger when unlinked', () => {
    const goal = createGoal(db, householdId, { name: 'Disney', targetMinor: 400000, currency: 'USD' })
    contributeToGoal(db, householdId, goal.id, { profileId, amountMinor: 100000, contributedOn: '2026-07-01' })
    contributeToGoal(db, householdId, goal.id, { profileId, amountMinor: 50000, contributedOn: '2026-07-15' })

    const dto = listGoals(db, householdId)[0]!
    expect(dto.savedMinor).toBe(150000)
    expect(dto.remainingMinor).toBe(250000)
    expect(dto.progress).toBeCloseTo(0.375)
  })

  it('tracks an account balance when linked, and refuses manual contributions', () => {
    const account = createAccount(db, householdId, { name: 'Savings', openingBalanceMinor: 120000 })
    const goal = createGoal(db, householdId, {
      name: 'Roof', targetMinor: 400000, currency: 'USD', accountId: account.id,
    })

    expect(listGoals(db, householdId)[0]!.savedMinor).toBe(120000)
    // Recording both would double-count the same money.
    expect(() => contributeToGoal(db, householdId, goal.id, {
      profileId, amountMinor: 1000, contributedOn: '2026-07-01',
    })).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('rounds the monthly figure up, so the target is actually reachable', () => {
    createGoal(db, householdId, {
      name: 'Bike', targetMinor: 100001, currency: 'USD',
      targetDate: '2099-01-01',
    })
    const dto = listGoals(db, householdId)[0]!
    expect(dto.perMonthNeededMinor! * Math.ceil(dto.daysRemaining! / 30)).toBeGreaterThanOrEqual(100001)
  })

  it('caps progress at 1 when the goal is beaten', () => {
    const goal = createGoal(db, householdId, { name: 'Small', targetMinor: 1000, currency: 'USD' })
    contributeToGoal(db, householdId, goal.id, { profileId, amountMinor: 5000, contributedOn: '2026-07-01' })
    expect(listGoals(db, householdId)[0]!.progress).toBe(1)
  })
})

// ── Forecast (pure) ───────────────────────────────────────────────────────

function occurrence(over: Partial<BillOccurrence>): BillOccurrence {
  return {
    billId: 'b1',
    name: 'Rent',
    kind: 'expense',
    dueDate: '2026-07-05',
    amountMinor: 125000,
    currency: 'USD',
    categoryId: null,
    categoryName: null,
    accountId: null,
    autoPay: false,
    status: 'due',
    paidAmountMinor: null,
    transactionId: null,
    ...over,
  }
}

describe('projectCashFlow', () => {
  const base = {
    today: '2026-07-01',
    days: 10,
    currency: 'USD',
    currencyExponent: 2,
    openingBalanceMinor: 200000,
    dailyDiscretionaryMinor: 0,
    occurrences: [],
  }

  it('subtracts a bill on its due date and nowhere else', () => {
    const result = projectCashFlow({ ...base, occurrences: [occurrence({ dueDate: '2026-07-05' })] })
    expect(result.days.find(d => d.date === '2026-07-04')!.balanceMinor).toBe(200000)
    expect(result.days.find(d => d.date === '2026-07-05')!.balanceMinor).toBe(75000)
    expect(result.endingBalanceMinor).toBe(75000)
  })

  it('adds income and reports the running totals', () => {
    const result = projectCashFlow({
      ...base,
      occurrences: [
        occurrence({ dueDate: '2026-07-05' }),
        occurrence({ billId: 'b2', name: 'Pay', kind: 'income', amountMinor: 245000, dueDate: '2026-07-03' }),
      ],
    })
    expect(result.totalBillsMinor).toBe(125000)
    expect(result.totalIncomeMinor).toBe(245000)
    expect(result.endingBalanceMinor).toBe(200000 + 245000 - 125000)
  })

  it('ignores a bill somebody already paid — otherwise rent is counted twice', () => {
    const result = projectCashFlow({
      ...base,
      occurrences: [occurrence({ status: 'paid' }), occurrence({ billId: 'b2', status: 'skipped' })],
    })
    expect(result.endingBalanceMinor).toBe(200000)
  })

  it('never mixes currencies into one total', () => {
    const result = projectCashFlow({
      ...base,
      occurrences: [occurrence({ currency: 'EUR', amountMinor: 999999 })],
    })
    expect(result.endingBalanceMinor).toBe(200000)
  })

  it('reports the lowest point and its date, which is the number people act on', () => {
    const result = projectCashFlow({
      ...base,
      occurrences: [
        occurrence({ dueDate: '2026-07-03', amountMinor: 180000 }),
        occurrence({ billId: 'b2', kind: 'income', amountMinor: 300000, dueDate: '2026-07-08' }),
      ],
    })
    expect(result.lowest).toEqual({ date: '2026-07-03', balanceMinor: 20000 })
    expect(result.endingBalanceMinor).toBe(320000)
  })

  it('flags the first day the projection goes negative', () => {
    const result = projectCashFlow({
      ...base,
      occurrences: [occurrence({ dueDate: '2026-07-04', amountMinor: 250000 })],
    })
    expect(result.shortfall).toEqual({ date: '2026-07-04', balanceMinor: -50000 })
  })

  it('reports no shortfall when the balance stays positive', () => {
    expect(projectCashFlow(base).shortfall).toBeNull()
  })

  it('applies everyday spend on every day', () => {
    const result = projectCashFlow({ ...base, dailyDiscretionaryMinor: 1000 })
    expect(result.endingBalanceMinor).toBe(200000 - 10 * 1000)
  })

  it('emits exactly the requested number of days, starting today', () => {
    const result = projectCashFlow({ ...base, days: 30 })
    expect(result.days).toHaveLength(30)
    expect(result.days[0]!.date).toBe('2026-07-01')
    expect(result.days.at(-1)!.date).toBe('2026-07-30')
  })
})

describe('averageDailySpend', () => {
  const txn = (amountMinor: number, categoryKind?: string) => ({ amountMinor, currency: 'USD', categoryKind })

  it('averages only outgoings', () => {
    expect(averageDailySpend({
      transactions: [txn(-3000), txn(-6000), txn(245000)],
      days: 90,
      currency: 'USD',
    })).toBe(100)
  })

  it('excludes transfers between the family’s own accounts', () => {
    expect(averageDailySpend({
      transactions: [txn(-9000), txn(-90000, 'transfer')],
      days: 90,
      currency: 'USD',
    })).toBe(100)
  })

  it('excludes other currencies rather than summing them', () => {
    expect(averageDailySpend({
      transactions: [txn(-9000), { amountMinor: -500000, currency: 'EUR' }],
      days: 90,
      currency: 'USD',
    })).toBe(100)
  })

  it('is zero with no history, rather than dividing by zero', () => {
    expect(averageDailySpend({ transactions: [], days: 0, currency: 'USD' })).toBe(0)
  })
})
