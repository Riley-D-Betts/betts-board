import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { addDaysToDateString, dateStringDiffDays, todayString } from '#shared/utils/dates'
import type { Db } from '../../db/client'
import { financeCategories, financeTransactionSplits, financeTransactions } from '../../db/schema'
import { listAccounts, netWorthByCurrency } from './accounts'
import { expandBills } from './bills'
import { budgetForMonth, currentMonth } from './budgets'
import { averageDailySpend, projectCashFlow, type ForecastResult } from './forecast'
import { listGoals } from './goals'

/** Days of history the discretionary-spend average is taken over. */
const TRAILING_DAYS = 90

/** Only spendable money projects forward; a credit limit is not cash. */
const CASH_TYPES = new Set(['checking', 'savings', 'cash'])

/**
 * Which accounts the opening balance was built from, and which ones were left
 * out for want of a type.
 *
 * The forecast counts spendable cash only, and a bank account's type is GUESSED
 * from its name on first sync — so a current account called "Riley and Kylee
 * (2822)" lands in `other` and is silently dropped from the projection. The
 * headline then reads as a catastrophe while the money is sitting right there
 * in the account list one card away. `credit`, `loan` and `investment` are
 * excluded on purpose and are not reported here; `other` means "nobody has said
 * what this is yet", which is a question for the household, not a decision.
 */
export interface ForecastAccounts {
  counted: { id: string, name: string, balanceMinor: number }[]
  unclassified: { id: string, name: string, balanceMinor: number }[]
}

export function buildForecast(db: Db, householdId: string, args: {
  currency: string
  currencyExponent: number
  days: number
}): ForecastResult & { accounts: ForecastAccounts } {
  const today = todayString()
  const accounts = listAccounts(db, householdId)

  const visible = accounts.filter(a => !a.isHidden && a.currency === args.currency)
  const counted = visible.filter(a => CASH_TYPES.has(a.type))
  const openingBalanceMinor = counted.reduce((acc, a) => acc + a.balanceMinor, 0)

  const trailingStart = addDaysToDateString(today, -TRAILING_DAYS)
  // Only spend that actually leaves the cash accounts we projected from.
  // Card spend is drawn against a credit line, not the current account, and it
  // reaches the cash balance later as the card-payment bill — which the
  // forecast already models. Counting both subtracts the same money twice.
  const cashAccountIds = new Set(
    accounts.filter(a => CASH_TYPES.has(a.type)).map(a => a.id),
  )
  // One row per SPLIT LINE, not per transaction. A shop that was half groceries
  // and half a utility bill has to be judged a line at a time — see the
  // exclusion below, which would otherwise throw away the grocery half too.
  // The lines of a transaction sum to it, so the total is unchanged for the
  // ordinary single-line case.
  const trailing = db.select({
    accountId: financeTransactions.accountId,
    amountMinor: financeTransactionSplits.amountMinor,
    currency: financeTransactions.currency,
    categoryId: financeTransactionSplits.categoryId,
    categoryKind: financeCategories.kind,
  })
    .from(financeTransactionSplits)
    .innerJoin(financeTransactions, eq(financeTransactions.id, financeTransactionSplits.transactionId))
    .leftJoin(financeCategories, eq(financeCategories.id, financeTransactionSplits.categoryId))
    .where(and(
      eq(financeTransactions.householdId, householdId),
      eq(financeTransactions.pending, false),
      gte(financeTransactions.postedDate, trailingStart),
      lt(financeTransactions.postedDate, today),
    ))
    .all()
    .filter(t => cashAccountIds.has(t.accountId))

  // Bills are modelled explicitly as occurrences, so their spend must not also
  // land in the daily average — otherwise every recurring cost is counted
  // twice and the projection is pessimistic by roughly a whole rent.
  //
  // This excludes the bill's whole CATEGORY, which over-excludes a little when
  // one category holds both a bill and one-off spend (a "Utilities" category
  // with the monthly electric bill plus a one-off connection fee). That is the
  // right direction to err in: slightly under-counting discretionary spend
  // beats double-counting the mortgage.
  //
  // It drops the LINE in a bill category, not the transaction that line belongs
  // to. A £180 shop with £20 of it filed under Utilities still contributes its
  // £160 of groceries to the average; dropping the whole receipt would erase
  // eight times the money the exclusion is meant to remove.
  const billCategoryIds = new Set(
    expandBills(db, householdId, trailingStart, today)
      .map(b => b.categoryId)
      .filter((id): id is string => !!id),
  )
  const discretionary = billCategoryIds.size
    ? trailing.filter(t => !t.categoryId || !billCategoryIds.has(t.categoryId))
    : trailing

  const occurrences = expandBills(db, householdId, today, addDaysToDateString(today, args.days))

  // Divide by the history we ACTUALLY have, not a flat 90 days. A household
  // five days into using the board has five days of spend; dividing it by 90
  // reports a daily average eighteen times too low and produces a comfortable
  // forecast that is simply wrong.
  //
  // The floor of 14 days is the other half of the guard: with two days of
  // history, dividing by two extrapolates one big shop into a catastrophe.
  // Under-reacting to very short history is the safer error.
  const oldest = db.select({ postedDate: financeTransactions.postedDate })
    .from(financeTransactions)
    .where(and(
      eq(financeTransactions.householdId, householdId),
      gte(financeTransactions.postedDate, trailingStart),
    ))
    .orderBy(asc(financeTransactions.postedDate))
    .limit(1)
    .get()

  const observedDays = oldest
    ? Math.max(1, dateStringDiffDays(today, oldest.postedDate))
    : TRAILING_DAYS
  const historyDays = Math.min(TRAILING_DAYS, Math.max(14, observedDays))

  const summarize = (a: { id: string, name: string, balanceMinor: number }) =>
    ({ id: a.id, name: a.name, balanceMinor: a.balanceMinor })

  return {
    ...projectCashFlow({
      today,
      days: args.days,
      currency: args.currency,
      currencyExponent: args.currencyExponent,
      openingBalanceMinor,
      occurrences,
      dailyDiscretionaryMinor: averageDailySpend({
        transactions: discretionary,
        days: historyDays,
        currency: args.currency,
      }),
    }),
    accounts: {
      counted: counted.map(summarize),
      unclassified: visible.filter(a => a.type === 'other').map(summarize),
    },
  }
}

/** Everything the finance landing page needs, in one round trip. */
export function financeOverview(db: Db, householdId: string, args: {
  currency: string
  currencyExponent: number
  forecastDays: number
}) {
  const today = todayString()
  const period = currentMonth(today)

  const upcoming = expandBills(db, householdId, today, addDaysToDateString(today, 30))
    .filter(b => b.status === 'due')
    .slice(0, 8)

  const overdue = expandBills(db, householdId, addDaysToDateString(today, -30), today)
    .filter(b => b.status === 'due')

  const budget = budgetForMonth(db, householdId, period, args.currency)

  return {
    currency: args.currency,
    currencyExponent: args.currencyExponent,
    netWorth: netWorthByCurrency(db, householdId),
    accounts: listAccounts(db, householdId).filter(a => !a.isHidden),
    upcomingBills: upcoming,
    overdueBills: overdue,
    budget: {
      period: budget.period,
      totalBudgetedMinor: budget.totalBudgetedMinor,
      totalSpentMinor: budget.totalSpentMinor,
      uncategorizedMinor: budget.uncategorizedMinor,
      overspent: budget.lines.filter(l => l.amountMinor > 0 && l.spentMinor > l.amountMinor).length,
    },
    goals: listGoals(db, householdId).slice(0, 4),
    forecast: buildForecast(db, householdId, {
      currency: args.currency,
      currencyExponent: args.currencyExponent,
      days: args.forecastDays,
    }),
  }
}
