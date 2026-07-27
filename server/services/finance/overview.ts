import { and, eq, gte, lt } from 'drizzle-orm'
import { addDaysToDateString, todayString } from '#shared/utils/dates'
import type { Db } from '../../db/client'
import { financeCategories, financeTransactions } from '../../db/schema'
import { listAccounts, netWorthByCurrency } from './accounts'
import { expandBills } from './bills'
import { budgetForMonth, currentMonth } from './budgets'
import { averageDailySpend, projectCashFlow, type ForecastResult } from './forecast'
import { listGoals } from './goals'

/** Days of history the discretionary-spend average is taken over. */
const TRAILING_DAYS = 90

/** Only spendable money projects forward; a credit limit is not cash. */
const CASH_TYPES = new Set(['checking', 'savings', 'cash'])

export function buildForecast(db: Db, householdId: string, args: {
  currency: string
  currencyExponent: number
  days: number
}): ForecastResult {
  const today = todayString()
  const accounts = listAccounts(db, householdId)

  const openingBalanceMinor = accounts
    .filter(a => !a.isHidden && a.currency === args.currency && CASH_TYPES.has(a.type))
    .reduce((acc, a) => acc + a.balanceMinor, 0)

  const trailingStart = addDaysToDateString(today, -TRAILING_DAYS)
  const trailing = db.select({
    amountMinor: financeTransactions.amountMinor,
    currency: financeTransactions.currency,
    categoryId: financeTransactions.categoryId,
    categoryKind: financeCategories.kind,
  })
    .from(financeTransactions)
    .leftJoin(financeCategories, eq(financeCategories.id, financeTransactions.categoryId))
    .where(and(
      eq(financeTransactions.householdId, householdId),
      eq(financeTransactions.pending, false),
      gte(financeTransactions.postedDate, trailingStart),
      lt(financeTransactions.postedDate, today),
    ))
    .all()

  // Bills are modelled explicitly as occurrences, so their spend must not also
  // land in the daily average — otherwise every recurring cost is counted
  // twice and the projection is pessimistic by roughly a whole rent.
  //
  // This excludes the bill's whole CATEGORY, which over-excludes a little when
  // one category holds both a bill and one-off spend (a "Utilities" category
  // with the monthly electric bill plus a one-off connection fee). That is the
  // right direction to err in: slightly under-counting discretionary spend
  // beats double-counting the mortgage.
  const billCategoryIds = new Set(
    expandBills(db, householdId, trailingStart, today)
      .map(b => b.categoryId)
      .filter((id): id is string => !!id),
  )
  const discretionary = billCategoryIds.size
    ? trailing.filter(t => !t.categoryId || !billCategoryIds.has(t.categoryId))
    : trailing

  const occurrences = expandBills(db, householdId, today, addDaysToDateString(today, args.days))

  return projectCashFlow({
    today,
    days: args.days,
    currency: args.currency,
    currencyExponent: args.currencyExponent,
    openingBalanceMinor,
    occurrences,
    dailyDiscretionaryMinor: averageDailySpend({
      transactions: discretionary,
      days: TRAILING_DAYS,
      currency: args.currency,
    }),
  })
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
