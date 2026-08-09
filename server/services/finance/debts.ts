import { and, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm'
import { todayString } from '#shared/utils/dates'
import type { Db } from '../../db/client'
import { financeAccounts, financeTransactions } from '../../db/schema'
import { createAccount, getAccount, listAccounts } from './accounts'
import { currentMonth, monthWindow } from './budgets'
import { createTransaction } from './transactions'

/** The account types the Debts tab is a view of. */
const DEBT_TYPES = new Set(['credit', 'loan'])

export interface DebtDto {
  /** The underlying account's id — every account route works on it. */
  id: string
  name: string
  orgName: string | null
  type: string
  currency: string
  currencyExponent: number
  source: 'bank' | 'ledger'
  connectionId: string | null
  /** What is owed right now. Zero for an overpaid card — never negative. */
  owedMinor: number
  /**
   * The original principal — the manual account's opening balance, which "Add
   * a debt" wrote as a negative number. Null for bank-synced debts (a card has
   * no fixed principal) and for manual accounts that didn't start in the red.
   */
  originalMinor: number | null
  paidDownMinor: number | null
  /** 0–1 toward zero; null whenever originalMinor is. */
  progress: number | null
  /** Posted payments this calendar month — synced or hand-recorded. */
  paidThisMonthMinor: number
  balanceAt: number | null
}

/**
 * Debts are accounts wearing their payoff face. There is deliberately no
 * `finance_debts` table: a debt that lived outside the accounts system would
 * need its own net-worth line, its own transaction history, and its own sync
 * story — three chances to disagree with the numbers one card over. Instead
 * "Add a debt" creates a manual account of type loan/credit whose opening
 * balance is the negative principal, and a payment is an ordinary positive
 * transaction on it. Net worth, the ledger, and this tab all read the same rows.
 */
export function listDebts(db: Db, householdId: string): DebtDto[] {
  const debts = listAccounts(db, householdId)
    .filter(a => DEBT_TYPES.has(a.type) && !a.isHidden)
  if (!debts.length) return []

  const ids = debts.map(a => a.id)

  // The manual accounts' opening balances — listAccounts only reports the
  // computed current balance, but for a debt the opening IS the principal.
  const openings = new Map(
    db.select({ id: financeAccounts.id, openingMinor: financeAccounts.balanceMinor })
      .from(financeAccounts)
      .where(and(
        eq(financeAccounts.householdId, householdId),
        eq(financeAccounts.balanceSource, 'ledger'),
        inArray(financeAccounts.id, ids),
      ))
      .all().map(r => [r.id, r.openingMinor]),
  )

  const { start, end } = monthWindow(currentMonth(todayString()))
  const paidThisMonth = new Map(
    db.select({
      accountId: financeTransactions.accountId,
      total: sql<number>`coalesce(sum(${financeTransactions.amountMinor}), 0)`,
    })
      .from(financeTransactions)
      .where(and(
        eq(financeTransactions.householdId, householdId),
        inArray(financeTransactions.accountId, ids),
        // Money INTO a debt account is a payment; posted only, like every
        // balance in the app — a pending payment is not money that moved yet.
        eq(financeTransactions.pending, false),
        gt(financeTransactions.amountMinor, 0),
        gte(financeTransactions.postedDate, start),
        lt(financeTransactions.postedDate, end),
      ))
      .groupBy(financeTransactions.accountId)
      .all().map(r => [r.accountId, r.total]),
  )

  return debts.map((a) => {
    const owedMinor = Math.max(0, -a.balanceMinor)
    const opening = openings.get(a.id)
    // A manual account that started at zero or positive was never "a debt of
    // X" — there is no principal to measure progress against.
    const originalMinor = opening !== undefined && opening < 0 ? -opening : null
    const paidDownMinor = originalMinor !== null ? Math.max(0, originalMinor - owedMinor) : null

    return {
      id: a.id,
      name: a.name,
      orgName: a.orgName,
      type: a.type,
      currency: a.currency,
      currencyExponent: a.currencyExponent,
      source: a.balanceSource,
      connectionId: a.connectionId,
      owedMinor,
      originalMinor,
      paidDownMinor,
      progress: originalMinor ? Math.min(1, (paidDownMinor ?? 0) / originalMinor) : null,
      paidThisMonthMinor: paidThisMonth.get(a.id) ?? 0,
      balanceAt: a.balanceAt,
    }
  }).sort((a, b) => (b.owedMinor - a.owedMinor) || a.name.localeCompare(b.name))
}

export function createDebt(db: Db, householdId: string, input: {
  name: string
  owedMinor: number
  type: 'loan' | 'credit'
  currency: string
}) {
  return createAccount(db, householdId, {
    name: input.name,
    type: input.type,
    currency: input.currency,
    // Negative: what you owe. This is the principal every progress bar on the
    // Debts tab measures against.
    openingBalanceMinor: -Math.abs(input.owedMinor),
    includeInNetWorth: true,
  })
}

/**
 * A payment is a positive transaction on the debt account — nothing more, so
 * the transactions page, net worth, and the debt's progress can't disagree.
 * Refused for bank-synced debts: the real payment arrives with the next sync,
 * and recording it by hand too would count the same money twice.
 */
export function recordDebtPayment(db: Db, householdId: string, accountId: string, input: {
  profileId: string
  amountMinor: number
  paidOn: string
  note?: string | null
}) {
  const account = getAccount(db, householdId, accountId)
  if (!DEBT_TYPES.has(account.type)) {
    throw createError({ statusCode: 400, statusMessage: 'Not a debt account' })
  }
  if (account.balanceSource === 'bank') {
    throw createError({
      statusCode: 400,
      statusMessage: 'This debt updates from your bank — the payment will arrive with the next sync',
    })
  }

  return createTransaction(db, {
    householdId,
    profileId: input.profileId,
    input: {
      accountId,
      postedDate: input.paidOn,
      amountMinor: Math.abs(input.amountMinor),
      description: input.note?.trim() || 'Payment',
    },
  })
}
