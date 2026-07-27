import { createHash } from 'node:crypto'
import { and, desc, eq, gte, like, lt, or, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { financeAccounts, financeCategories, financeTransactions } from '../../db/schema'
import { getAccount } from './accounts'
import { applyRules, listRules } from './rules'

export type TransactionRow = typeof financeTransactions.$inferSelect

/**
 * A candidate-finder for import dedup, NOT a uniqueness constraint — two $5
 * coffees on the same day are both real, and a unique index here would drop
 * the second one silently.
 */
export function dedupeHashFor(args: { accountId: string, postedDate: string, amountMinor: number, description: string }): string {
  const normalized = args.description.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return createHash('sha256')
    .update(`${args.accountId}|${args.postedDate}|${args.amountMinor}|${normalized}`)
    .digest('hex')
    .slice(0, 32)
}

export interface TransactionQuery {
  accountId?: string
  categoryId?: string
  start?: string
  end?: string
  q?: string
  uncategorized?: boolean
  limit: number
  offset: number
}

export function listTransactions(db: Db, householdId: string, query: TransactionQuery) {
  const filters = [eq(financeTransactions.householdId, householdId)]
  if (query.accountId) filters.push(eq(financeTransactions.accountId, query.accountId))
  if (query.categoryId) filters.push(eq(financeTransactions.categoryId, query.categoryId))
  // Half-open window, matching the calendar convention: start inclusive, end
  // exclusive. YYYY-MM-DD strings sort lexicographically, so no date maths.
  if (query.start) filters.push(gte(financeTransactions.postedDate, query.start))
  if (query.end) filters.push(lt(financeTransactions.postedDate, query.end))
  if (query.uncategorized) filters.push(sql`${financeTransactions.categoryId} is null`)
  if (query.q) {
    const needle = `%${query.q.toLowerCase()}%`
    filters.push(or(
      like(sql`lower(${financeTransactions.description})`, needle),
      like(sql`lower(coalesce(${financeTransactions.payee}, ''))`, needle),
      like(sql`lower(coalesce(${financeTransactions.memo}, ''))`, needle),
    )!)
  }

  const where = and(...filters)
  const total = db.select({ n: sql<number>`count(*)` }).from(financeTransactions).where(where).get()?.n ?? 0

  const rows = db.select({
    txn: financeTransactions,
    accountName: financeAccounts.name,
    categoryName: financeCategories.name,
    categoryIcon: financeCategories.icon,
    categoryColor: financeCategories.color,
  })
    .from(financeTransactions)
    .innerJoin(financeAccounts, eq(financeAccounts.id, financeTransactions.accountId))
    .leftJoin(financeCategories, eq(financeCategories.id, financeTransactions.categoryId))
    .where(where)
    .orderBy(desc(financeTransactions.postedDate), desc(financeTransactions.createdAt))
    .limit(query.limit)
    .offset(query.offset)
    .all()

  return {
    total,
    items: rows.map(({ txn, ...meta }) => ({
      id: txn.id,
      accountId: txn.accountId,
      accountName: meta.accountName,
      postedDate: txn.postedDate,
      postedAt: txn.postedAt.getTime(),
      amountMinor: txn.amountMinor,
      currency: txn.currency,
      currencyExponent: txn.currencyExponent,
      description: txn.description,
      payee: txn.payee,
      memo: txn.memo,
      pending: txn.pending,
      categoryId: txn.categoryId,
      categoryName: meta.categoryName,
      categoryIcon: meta.categoryIcon,
      categoryColor: meta.categoryColor,
      notes: txn.notes,
      source: txn.source,
    })),
  }
}

export function createTransaction(db: Db, args: {
  householdId: string
  profileId: string
  input: {
    accountId: string
    postedDate: string
    amountMinor: number
    description: string
    payee?: string | null
    memo?: string | null
    categoryId?: string | null
    notes?: string | null
  }
}) {
  const account = getAccount(db, args.householdId, args.input.accountId)
  const { input } = args

  // Rules run on manual entry too — otherwise "why did my imported Amazon
  // charge get a category and the one I typed didn't" is a fair question.
  const effect = input.categoryId
    ? null
    : applyRules(listRules(db, args.householdId), {
        description: input.description,
        payee: input.payee,
        memo: input.memo,
        accountId: input.accountId,
      })

  return db.insert(financeTransactions).values({
    householdId: args.householdId,
    accountId: account.id,
    postedDate: input.postedDate,
    // Midday local, so a timezone shift can never move the row across a day
    // boundary. postedDate is the authoritative field; this is for ordering.
    postedAt: new Date(`${input.postedDate}T12:00:00`),
    amountMinor: input.amountMinor,
    currency: account.currency,
    currencyExponent: account.currencyExponent,
    description: input.description,
    payee: input.payee ?? effect?.payee ?? null,
    memo: input.memo ?? null,
    categoryId: input.categoryId ?? effect?.categoryId ?? null,
    categorizedBy: input.categoryId ? 'user' : (effect?.categoryId ? 'rule' : null),
    notes: input.notes ?? null,
    source: 'manual',
    dedupeHash: dedupeHashFor({
      accountId: account.id,
      postedDate: input.postedDate,
      amountMinor: input.amountMinor,
      description: input.description,
    }),
    createdByProfileId: args.profileId,
  }).returning().get()
}

export function patchTransaction(db: Db, householdId: string, id: string, patch: Record<string, unknown>) {
  const row = db.select().from(financeTransactions)
    .where(and(eq(financeTransactions.id, id), eq(financeTransactions.householdId, householdId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })

  if (row.source === 'sync' && ('amountMinor' in patch || 'postedDate' in patch)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Amount and date come from the bank — the next sync would overwrite an edit',
    })
  }

  const values: Record<string, unknown> = { ...patch }
  if ('categoryId' in patch) values.categorizedBy = patch.categoryId ? 'user' : null
  if (typeof patch.postedDate === 'string') values.postedAt = new Date(`${patch.postedDate}T12:00:00`)

  return db.update(financeTransactions).set(values).where(eq(financeTransactions.id, id)).returning().get()
}

export function deleteTransaction(db: Db, householdId: string, id: string): void {
  const row = db.select().from(financeTransactions)
    .where(and(eq(financeTransactions.id, id), eq(financeTransactions.householdId, householdId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })
  if (row.source === 'sync') {
    throw createError({ statusCode: 400, statusMessage: 'Synced transactions come back on the next sync' })
  }
  db.delete(financeTransactions).where(eq(financeTransactions.id, id)).run()
}

/** Spend per category over a half-open window. Excludes pending rows. */
export function spendByCategory(db: Db, householdId: string, start: string, end: string) {
  return db.select({
    categoryId: financeTransactions.categoryId,
    currency: financeTransactions.currency,
    totalMinor: sql<number>`sum(${financeTransactions.amountMinor})`,
    n: sql<number>`count(*)`,
  })
    .from(financeTransactions)
    .where(and(
      eq(financeTransactions.householdId, householdId),
      eq(financeTransactions.pending, false),
      gte(financeTransactions.postedDate, start),
      lt(financeTransactions.postedDate, end),
    ))
    .groupBy(financeTransactions.categoryId, financeTransactions.currency)
    .all()
}
