import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { currencyExponent } from '#shared/utils/money'
import type { Db } from '../../db/client'
import { financeAccounts, financeConnections, financeTransactions } from '../../db/schema'

export interface AccountDto {
  id: string
  connectionId: string | null
  connectionNickname: string | null
  connectionStatus: string | null
  orgName: string | null
  name: string
  type: string
  currency: string
  currencyExponent: number
  balanceSource: 'bank' | 'ledger'
  balanceMinor: number
  availableBalanceMinor: number | null
  balanceAt: number | null
  isHidden: boolean
  includeInNetWorth: boolean
  sortOrder: number
  archivedAt: number | null
  transactionCount: number
}

/**
 * A ledger account's balance IS its rows; a synced account's balance is
 * whatever the bank last said. Never recompute a synced balance from
 * transactions — SimpleFIN only guarantees a window of history, so the sum
 * would be wrong, and confidently so.
 */
function ledgerBalance(db: Db, accountId: string, openingMinor: number): number {
  const row = db.select({ total: sql<number>`coalesce(sum(${financeTransactions.amountMinor}), 0)` })
    .from(financeTransactions)
    .where(and(eq(financeTransactions.accountId, accountId), eq(financeTransactions.pending, false)))
    .get()
  return openingMinor + (row?.total ?? 0)
}

export function listAccounts(db: Db, householdId: string, includeArchived = false): AccountDto[] {
  const rows = db.select({ account: financeAccounts, connection: financeConnections })
    .from(financeAccounts)
    .leftJoin(financeConnections, eq(financeConnections.id, financeAccounts.connectionId))
    .where(includeArchived
      ? eq(financeAccounts.householdId, householdId)
      : and(eq(financeAccounts.householdId, householdId), isNull(financeAccounts.archivedAt)))
    .orderBy(asc(financeAccounts.sortOrder), asc(financeAccounts.name))
    .all()

  const counts = new Map<string, number>()
  for (const r of db.select({
    accountId: financeTransactions.accountId,
    n: sql<number>`count(*)`,
  }).from(financeTransactions).groupBy(financeTransactions.accountId).all()) {
    counts.set(r.accountId, r.n)
  }

  return rows.map(({ account: a, connection: c }) => ({
    id: a.id,
    connectionId: a.connectionId,
    connectionNickname: c?.nickname ?? null,
    connectionStatus: c?.status ?? null,
    orgName: a.orgName,
    name: a.name,
    type: a.type,
    currency: a.currency,
    currencyExponent: a.currencyExponent,
    balanceSource: a.balanceSource,
    balanceMinor: a.balanceSource === 'ledger' ? ledgerBalance(db, a.id, a.balanceMinor) : a.balanceMinor,
    availableBalanceMinor: a.availableBalanceMinor,
    balanceAt: a.balanceAt?.getTime() ?? null,
    isHidden: a.isHidden,
    includeInNetWorth: a.includeInNetWorth,
    sortOrder: a.sortOrder,
    archivedAt: a.archivedAt?.getTime() ?? null,
    transactionCount: counts.get(a.id) ?? 0,
  }))
}

export function getAccount(db: Db, householdId: string, id: string) {
  const row = db.select().from(financeAccounts)
    .where(and(eq(financeAccounts.id, id), eq(financeAccounts.householdId, householdId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  return row
}

export function createAccount(db: Db, householdId: string, input: {
  name: string
  type?: 'checking' | 'savings' | 'credit' | 'cash' | 'investment' | 'loan' | 'other'
  currency?: string
  openingBalanceMinor?: number
  includeInNetWorth?: boolean
}) {
  const max = db.select({ sortOrder: financeAccounts.sortOrder }).from(financeAccounts)
    .where(eq(financeAccounts.householdId, householdId)).all()
    .reduce((acc, r) => Math.max(acc, r.sortOrder), -1)

  const currency = input.currency ?? 'USD'
  return db.insert(financeAccounts).values({
    householdId,
    name: input.name,
    type: input.type ?? 'checking',
    currency,
    currencyExponent: currencyExponent(currency),
    // Manual account: the stored balance is the OPENING balance, and the
    // reported balance is that plus the ledger.
    balanceSource: 'ledger',
    balanceMinor: input.openingBalanceMinor ?? 0,
    includeInNetWorth: input.includeInNetWorth ?? true,
    sortOrder: max + 1,
  }).returning().get()
}

export function patchAccount(db: Db, householdId: string, id: string, patch: Record<string, unknown>) {
  const row = getAccount(db, householdId, id)
  const { archived, balanceMinor, ...rest } = patch as { archived?: boolean, balanceMinor?: number }

  const values: Record<string, unknown> = { ...rest }
  if (archived !== undefined) values.archivedAt = archived ? new Date() : null
  if (balanceMinor !== undefined) {
    if (row.balanceSource === 'bank') {
      throw createError({
        statusCode: 400,
        statusMessage: 'This balance comes from the bank — edit the transactions instead',
      })
    }
    values.balanceMinor = balanceMinor
  }

  return db.update(financeAccounts).set(values).where(eq(financeAccounts.id, id)).returning().get()
}

/**
 * Hard delete, cascading to transactions. Only ever offered for manual
 * accounts — a synced account comes back on the next sync, so deleting it
 * would look broken. Disconnect the bank instead.
 */
export function deleteAccount(db: Db, householdId: string, id: string): void {
  const row = getAccount(db, householdId, id)
  if (row.connectionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This account comes from a bank connection — disconnect the bank to remove it',
    })
  }
  db.delete(financeAccounts).where(eq(financeAccounts.id, id)).run()
}

/**
 * Net worth, grouped by currency. Deliberately never summed across currencies:
 * there is no FX rate in this app, and silently adding €100 to $100 is the
 * classic finance-app bug.
 */
export function netWorthByCurrency(db: Db, householdId: string) {
  const totals = new Map<string, { assetsMinor: number, liabilitiesMinor: number, exponent: number }>()
  for (const a of listAccounts(db, householdId)) {
    if (!a.includeInNetWorth || a.isHidden) continue
    const entry = totals.get(a.currency) ?? { assetsMinor: 0, liabilitiesMinor: 0, exponent: a.currencyExponent }
    // Credit cards and loans carry a negative balance; keep the two sides
    // visible rather than collapsing them into one number.
    if (a.balanceMinor < 0) entry.liabilitiesMinor += a.balanceMinor
    else entry.assetsMinor += a.balanceMinor
    totals.set(a.currency, entry)
  }
  return [...totals.entries()].map(([currency, t]) => ({
    currency,
    currencyExponent: t.exponent,
    assetsMinor: t.assetsMinor,
    liabilitiesMinor: t.liabilitiesMinor,
    netMinor: t.assetsMinor + t.liabilitiesMinor,
  }))
}
