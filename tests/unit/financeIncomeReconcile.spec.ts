import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings, financeAccounts, financeBillPayments, financeBills,
  financeCategories, financeConnections, financeTransactions, households, profiles,
} from '../../server/db/schema'
import { addDaysToDateString, todayString } from '../../shared/utils/dates'
import { installNitroGlobals } from '../support/nitroGlobals'

installNitroGlobals()

const { createBill, expandBills, markBillOccurrence } = await import('../../server/services/finance/bills')
const { createAccount } = await import('../../server/services/finance/accounts')
const { createTransaction } = await import('../../server/services/finance/transactions')
const { setSplits } = await import('../../server/services/finance/splits')

let db: Db
let householdId: string
let profileId: string
let accountId: string

const TODAY = todayString()
const WINDOW_START = addDaysToDateString(TODAY, -60)
const WINDOW_END = addDaysToDateString(TODAY, 60)

beforeAll(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
})

beforeEach(() => {
  for (const table of [
    financeBillPayments, financeBills, financeTransactions, financeCategories,
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
  accountId = createAccount(db, householdId, { name: 'Checking', type: 'checking' }).id
})

/** A paycheck due `daysAgo` days back, repeating monthly. */
function paycheck(over: Record<string, unknown> = {}) {
  return createBill(db, householdId, {
    name: 'Paycheck',
    kind: 'income',
    amountMinor: 250000,
    currency: 'USD',
    startDate: addDaysToDateString(TODAY, -10),
    rrule: 'FREQ=MONTHLY',
    ...over,
  })
}

function deposit(over: Record<string, unknown> = {}) {
  return createTransaction(db, {
    householdId,
    profileId,
    input: {
      accountId,
      postedDate: addDaysToDateString(TODAY, -10),
      amountMinor: 250000,
      description: 'ACME PAYROLL',
      ...over,
    } as never,
  })
}

function occurrenceOn(dueDate: string) {
  return expandBills(db, householdId, WINDOW_START, WINDOW_END).find(o => o.dueDate === dueDate)
}

describe('income auto-reconciliation', () => {
  it('settles a past paycheck against the deposit that landed for it', () => {
    const bill = paycheck()
    const txn = deposit()

    const occ = occurrenceOn(addDaysToDateString(TODAY, -10))!
    expect(occ.billId).toBe(bill.id)
    expect(occ.status).toBe('paid')
    expect(occ.autoMatched).toBe(true)
    expect(occ.transactionId).toBe(txn.id)
    // The real amount, not the estimate — that is the whole point of matching.
    expect(occ.paidAmountMinor).toBe(250000)
  })

  it('matches a deposit a few days either side of the due date', () => {
    paycheck()
    deposit({ postedDate: addDaysToDateString(TODAY, -12) })
    expect(occurrenceOn(addDaysToDateString(TODAY, -10))!.status).toBe('paid')
  })

  it('leaves the occurrence due when no deposit landed', () => {
    paycheck()
    const occ = occurrenceOn(addDaysToDateString(TODAY, -10))!
    expect(occ.status).toBe('due')
    expect(occ.autoMatched).toBe(false)
    expect(occ.transactionId).toBeNull()
  })

  it('does not reach past the window for a deposit', () => {
    paycheck()
    deposit({ postedDate: addDaysToDateString(TODAY, -20) })
    expect(occurrenceOn(addDaysToDateString(TODAY, -10))!.status).toBe('due')
  })

  it('accepts a paycheck that varies with hours but not an unrelated deposit', () => {
    paycheck()
    deposit({ amountMinor: 265000 })
    expect(occurrenceOn(addDaysToDateString(TODAY, -10))!.status).toBe('paid')
  })

  it('ignores a deposit nothing like the expected amount', () => {
    paycheck()
    deposit({ amountMinor: 900 })
    expect(occurrenceOn(addDaysToDateString(TODAY, -10))!.status).toBe('due')
  })

  it('never lets one deposit settle two occurrences', () => {
    // Semi-monthly pay, two occurrences three days apart, one deposit.
    paycheck({
      startDate: addDaysToDateString(TODAY, -13),
      rrule: null,
    })
    paycheck({
      name: 'Paycheck B',
      startDate: addDaysToDateString(TODAY, -10),
      rrule: null,
    })
    deposit({ postedDate: addDaysToDateString(TODAY, -11) })

    const settled = expandBills(db, householdId, WINDOW_START, WINDOW_END)
      .filter(o => o.status === 'paid')
    expect(settled).toHaveLength(1)
    // The closer due date wins the deposit.
    expect(settled[0]!.dueDate).toBe(addDaysToDateString(TODAY, -10))
  })

  it('never auto-settles income that is not due yet', () => {
    paycheck({ startDate: addDaysToDateString(TODAY, 5), rrule: null })
    // A deposit sitting right on the future due date is somebody else's money.
    deposit({ postedDate: addDaysToDateString(TODAY, 5) })
    expect(occurrenceOn(addDaysToDateString(TODAY, 5))!.status).toBe('due')
  })

  it('never auto-settles an expense — a refund does not pay the rent', () => {
    createBill(db, householdId, {
      name: 'Rent',
      kind: 'expense',
      amountMinor: 250000,
      currency: 'USD',
      startDate: addDaysToDateString(TODAY, -10),
      rrule: null,
    })
    deposit()
    expect(occurrenceOn(addDaysToDateString(TODAY, -10))!.status).toBe('due')
  })

  it('a decision somebody made by hand always wins', () => {
    const bill = paycheck()
    deposit()
    markBillOccurrence(db, householdId, bill.id, {
      dueDate: addDaysToDateString(TODAY, -10),
      status: 'skipped',
    })
    const occ = occurrenceOn(addDaysToDateString(TODAY, -10))!
    expect(occ.status).toBe('skipped')
    expect(occ.autoMatched).toBe(false)
  })

  it('honours the account the bill is tied to', () => {
    const other = createAccount(db, householdId, { name: 'Savings', type: 'savings' }).id
    paycheck({ accountId: other })
    deposit() // lands in Checking, not Savings
    expect(occurrenceOn(addDaysToDateString(TODAY, -10))!.status).toBe('due')
  })

  it('ignores a pending deposit — a hold is not money received', () => {
    paycheck()
    const txn = deposit()
    db.update(financeTransactions).set({ pending: true })
      .where(eq(financeTransactions.id, txn.id)).run()
    expect(occurrenceOn(addDaysToDateString(TODAY, -10))!.status).toBe('due')
  })

  it('never counts money out as income', () => {
    paycheck()
    deposit({ amountMinor: -250000 })
    expect(occurrenceOn(addDaysToDateString(TODAY, -10))!.status).toBe('due')
  })

  it('a transfer between the household\'s own accounts is not income', () => {
    const transferCategory = db.insert(financeCategories)
      .values({ householdId, name: 'Transfers', kind: 'transfer' }).returning().get()
    paycheck()
    deposit({ categoryId: transferCategory.id })
    expect(occurrenceOn(addDaysToDateString(TODAY, -10))!.status).toBe('due')
  })

  it('recategorising a matched deposit as a transfer un-matches it', () => {
    const transferCategory = db.insert(financeCategories)
      .values({ householdId, name: 'Transfers', kind: 'transfer' }).returning().get()
    paycheck()
    const txn = deposit()
    expect(occurrenceOn(addDaysToDateString(TODAY, -10))!.status).toBe('paid')

    setSplits(db, txn.id, txn.amountMinor, [{ amountMinor: txn.amountMinor, categoryId: transferCategory.id }])
    expect(occurrenceOn(addDaysToDateString(TODAY, -10))!.status).toBe('due')
  })

  it('paying the credit card is not being paid', () => {
    const card = createAccount(db, householdId, { name: 'Visa', type: 'credit' }).id
    paycheck()
    // A card payment posts as POSITIVE money on the credit account.
    deposit({ accountId: card })
    expect(occurrenceOn(addDaysToDateString(TODAY, -10))!.status).toBe('due')
  })

  it('a deposit somebody hand-linked to one occurrence cannot settle another', () => {
    const billA = paycheck({ startDate: addDaysToDateString(TODAY, -13), rrule: null })
    paycheck({ name: 'Paycheck B', startDate: addDaysToDateString(TODAY, -10), rrule: null })
    const txn = deposit({ postedDate: addDaysToDateString(TODAY, -11) })

    markBillOccurrence(db, householdId, billA.id, {
      dueDate: addDaysToDateString(TODAY, -13),
      status: 'paid',
      transactionId: txn.id,
    })

    // Without the exclusion, the matcher hands B the very deposit the override
    // already spent on A — one paycheck's money settling two occurrences.
    const b = occurrenceOn(addDaysToDateString(TODAY, -10))!
    expect(b.status).toBe('due')
  })

  // The overview composes several expansions (overdue, upcoming, forecast) in
  // one response. Matching must be solved over the same universe every time,
  // or a deposit claimed by an occurrence in one window is free again in the
  // next and both cards show "received" off a single deposit.
  it('windows that see different occurrences still agree on who got the deposit', () => {
    paycheck({ name: 'A', startDate: addDaysToDateString(TODAY, -1), rrule: null })
    paycheck({ name: 'B', startDate: TODAY, rrule: null })
    deposit({ postedDate: addDaysToDateString(TODAY, -1) })

    // The overdue-style window: contains only A. A wins the deposit (gap 0).
    const past = expandBills(db, householdId, addDaysToDateString(TODAY, -30), TODAY)
    expect(past.find(o => o.name === 'A')!.status).toBe('paid')

    // The upcoming-style window: contains only B. B must NOT claim the same
    // deposit A already has — even though A is outside this window.
    const future = expandBills(db, householdId, TODAY, addDaysToDateString(TODAY, 30))
    expect(future.find(o => o.name === 'B')!.status).toBe('due')
  })

  it('a dead-even tie is settled deterministically, not by row order', () => {
    const a = paycheck({ name: 'His', rrule: null })
    const b = paycheck({ name: 'Hers', rrule: null })
    deposit()

    const settle = () => expandBills(db, householdId, WINDOW_START, WINDOW_END)
      .filter(o => o.status === 'paid')
    const first = settle()
    expect(first).toHaveLength(1)
    // Same gap, same drift, same due date: the bill id breaks the tie.
    expect(first[0]!.billId).toBe([a.id, b.id].sort()[0])
    expect(settle()[0]!.billId).toBe(first[0]!.billId)
  })
})
