import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings, financeAccounts, financeConnections, financeTransactions,
  households, profiles,
} from '../../server/db/schema'
import { addDaysToDateString, todayString } from '../../shared/utils/dates'
import { installNitroGlobals } from '../support/nitroGlobals'

installNitroGlobals()

const { createDebt, listDebts, recordDebtPayment } = await import('../../server/services/finance/debts')
const { createAccount, netWorthByCurrency, patchAccount } = await import('../../server/services/finance/accounts')

const TODAY = todayString()
/** A date inside the current calendar month, never before its 1st. */
const THIS_MONTH = TODAY
const LAST_MONTH = addDaysToDateString(`${TODAY.slice(0, 7)}-01`, -1)

let db: Db
let householdId: string
let profileId: string

beforeAll(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
})

beforeEach(() => {
  for (const table of [financeTransactions, financeAccounts, financeConnections]) db.delete(table).run()
  db.delete(profiles).run()
  db.delete(households).run()

  householdId = db.insert(households).values({
    name: 'Betts', passwordHash: 'x', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get().id
  profileId = db.insert(profiles)
    .values({ householdId, name: 'Dad', color: '#112233', role: 'admin' })
    .returning().get().id
})

function debt(over: Record<string, unknown> = {}) {
  return createDebt(db, householdId, {
    name: 'Hope Medical', owedMinor: 120000, type: 'loan', currency: 'USD', ...over,
  } as never)
}

describe('debts', () => {
  it('a new debt owes its principal and has made no progress', () => {
    debt()
    const [d] = listDebts(db, householdId)
    expect(d).toMatchObject({
      name: 'Hope Medical',
      owedMinor: 120000,
      originalMinor: 120000,
      paidDownMinor: 0,
      progress: 0,
      paidThisMonthMinor: 0,
      source: 'ledger',
    })
  })

  it('a debt lowers net worth the moment it exists', () => {
    debt()
    expect(netWorthByCurrency(db, householdId)[0]!.liabilitiesMinor).toBe(-120000)
  })

  it('a payment shrinks what is owed and moves the bar', () => {
    const d = debt()
    recordDebtPayment(db, householdId, d.id, { profileId, amountMinor: 30000, paidOn: THIS_MONTH })

    const [row] = listDebts(db, householdId)
    expect(row!.owedMinor).toBe(90000)
    expect(row!.paidDownMinor).toBe(30000)
    expect(row!.progress).toBeCloseTo(0.25)
    expect(row!.paidThisMonthMinor).toBe(30000)
  })

  it('only this month counts as "paid this month"', () => {
    const d = debt()
    recordDebtPayment(db, householdId, d.id, { profileId, amountMinor: 30000, paidOn: LAST_MONTH })
    const [row] = listDebts(db, householdId)
    expect(row!.owedMinor).toBe(90000) // the payment still counts toward payoff
    expect(row!.paidThisMonthMinor).toBe(0)
  })

  it('progress caps at 1 even when overpaid', () => {
    const d = debt()
    recordDebtPayment(db, householdId, d.id, { profileId, amountMinor: 150000, paidOn: THIS_MONTH })
    const [row] = listDebts(db, householdId)
    expect(row!.owedMinor).toBe(0)
    expect(row!.progress).toBe(1)
  })

  it('a bank-synced card is listed without a principal, and refuses hand payments', () => {
    const connection = db.insert(financeConnections).values({
      householdId, provider: 'simplefin', accessUrlEnc: 'x',
    }).returning().get()
    const card = db.insert(financeAccounts).values({
      householdId, connectionId: connection.id, externalId: 'c1', name: 'Capital One',
      type: 'credit', currency: 'USD', currencyExponent: 2,
      balanceSource: 'bank', balanceMinor: -45000,
    }).returning().get()
    db.insert(financeTransactions).values({
      householdId, accountId: card.id, postedDate: THIS_MONTH,
      postedAt: new Date(), amountMinor: 10000, currency: 'USD',
      currencyExponent: 2, description: 'PAYMENT RECEIVED', pending: false,
    }).run()

    const [row] = listDebts(db, householdId)
    expect(row).toMatchObject({
      owedMinor: 45000,
      originalMinor: null,
      progress: null,
      paidThisMonthMinor: 10000,
      source: 'bank',
    })

    expect(() => recordDebtPayment(db, householdId, card.id, {
      profileId, amountMinor: 5000, paidOn: THIS_MONTH,
    })).toThrowError(/next sync/)
  })

  it('never lists cash accounts, hidden debts, or another household\'s', () => {
    createAccount(db, householdId, { name: 'Checking', type: 'checking' })
    const hidden = debt({ name: 'Hidden' })
    patchAccount(db, householdId, hidden.id, { isHidden: true })
    debt({ name: 'Visible' })

    expect(listDebts(db, householdId).map(d => d.name)).toEqual(['Visible'])
  })

  it('refuses to record a payment against a cash account', () => {
    const checking = createAccount(db, householdId, { name: 'Checking', type: 'checking' })
    expect(() => recordDebtPayment(db, householdId, checking.id, {
      profileId, amountMinor: 5000, paidOn: THIS_MONTH,
    })).toThrowError(/Not a debt/)
  })

  it('biggest debt first — the one that hurts is the one on top', () => {
    debt({ name: 'Small', owedMinor: 5000 })
    debt({ name: 'Big', owedMinor: 900000 })
    expect(listDebts(db, householdId).map(d => d.name)).toEqual(['Big', 'Small'])
  })
})
