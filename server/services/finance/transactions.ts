import { createHash } from 'node:crypto'
import { and, desc, eq, gte, like, lt, or, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { financeAccounts, financeTransactionSplits, financeTransactions } from '../../db/schema'
import { getAccount } from './accounts'
import { applyRules, listRules } from './rules'
import {
  derivedCategoryId, isSplit, setSplits, singleSplit, splitsFor, splitsForOne,
  type SplitInput,
} from './splits'

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
  // Category filters go through the splits table: "in this category" now means
  // "has a line in this category", which is what a user means when a receipt is
  // partly groceries.
  if (query.categoryId) {
    filters.push(sql`exists (
      select 1 from ${financeTransactionSplits}
      where ${financeTransactionSplits.transactionId} = ${financeTransactions.id}
        and ${financeTransactionSplits.categoryId} = ${query.categoryId}
    )`)
  }
  // Half-open window, matching the calendar convention: start inclusive, end
  // exclusive. YYYY-MM-DD strings sort lexicographically, so no date maths.
  if (query.start) filters.push(gte(financeTransactions.postedDate, query.start))
  if (query.end) filters.push(lt(financeTransactions.postedDate, query.end))
  if (query.uncategorized) {
    filters.push(sql`exists (
      select 1 from ${financeTransactionSplits}
      where ${financeTransactionSplits.transactionId} = ${financeTransactions.id}
        and ${financeTransactionSplits.categoryId} is null
    )`)
  }
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
  })
    .from(financeTransactions)
    .innerJoin(financeAccounts, eq(financeAccounts.id, financeTransactions.accountId))
    .where(where)
    .orderBy(desc(financeTransactions.postedDate), desc(financeTransactions.createdAt))
    .limit(query.limit)
    .offset(query.offset)
    .all()

  // One query for the whole page's splits, not one per row.
  const splitsByTransaction = splitsFor(db, rows.map(r => r.txn.id))

  return {
    total,
    items: rows.map(({ txn, accountName }) => {
      const splits = splitsByTransaction.get(txn.id) ?? []
      const single = splits.length === 1 ? splits[0]! : null
      return {
        id: txn.id,
        accountId: txn.accountId,
        accountName,
        postedDate: txn.postedDate,
        postedAt: txn.postedAt.getTime(),
        amountMinor: txn.amountMinor,
        currency: txn.currency,
        currencyExponent: txn.currencyExponent,
        description: txn.description,
        payee: txn.payee,
        memo: txn.memo,
        pending: txn.pending,
        splits,
        isSplit: isSplit(splits),
        // Derived, read-only: the category when there's exactly one line, null
        // when genuinely split. Keeps a script that reads `categoryId` working
        // for the ordinary case without being a second source of truth.
        categoryId: derivedCategoryId(splits),
        categoryName: single?.categoryName ?? null,
        categoryIcon: single?.categoryIcon ?? null,
        categoryColor: single?.categoryColor ?? null,
        notes: txn.notes,
        source: txn.source,
      }
    }),
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
    /** Omitted = one line for the whole amount, which is the ordinary case. */
    splits?: SplitInput[]
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

  const created = db.insert(financeTransactions).values({
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

  // An explicit split set wins; otherwise one line carrying the whole amount,
  // categorised by hand or by a rule exactly as before.
  setSplits(db, created.id, created.amountMinor, input.splits?.length
    ? input.splits
    : singleSplit({
        amountMinor: created.amountMinor,
        categoryId: input.categoryId ?? effect?.categoryId ?? null,
        categorizedBy: input.categoryId ? 'user' : 'rule',
      }))

  return created
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

  const { splits, categoryId, ...rest } = patch as {
    splits?: SplitInput[]
    categoryId?: string | null
  }
  const values: Record<string, unknown> = { ...rest }
  if (typeof patch.postedDate === 'string') values.postedAt = new Date(`${patch.postedDate}T12:00:00`)

  const updated = Object.keys(values).length
    ? db.update(financeTransactions).set(values).where(eq(financeTransactions.id, id)).returning().get()
    : row

  // Splits are replaced wholesale and must balance against the amount AFTER
  // this patch — editing the amount and the lines in one request has to be
  // judged against the new total, not the old one.
  if (splits?.length) {
    setSplits(db, id, updated.amountMinor, splits)
  }
  else if ('categoryId' in patch) {
    // The simple path: recategorising an unsplit transaction. Refused on a
    // split one, because collapsing somebody's hand-made lines into a single
    // category is destructive and there'd be no way to tell it happened.
    const existing = splitsForOne(db, id)
    if (existing.length > 1) {
      throw createError({
        statusCode: 400,
        statusMessage: 'This transaction is split across categories — edit its split lines instead',
      })
    }
    setSplits(db, id, updated.amountMinor, singleSplit({
      amountMinor: updated.amountMinor,
      categoryId: categoryId ?? null,
      categorizedBy: 'user',
    }))
  }
  else if (updated.amountMinor !== row.amountMinor) {
    // The amount moved but the lines didn't. An unsplit transaction can follow
    // along; a split one cannot be rebalanced for the user without guessing.
    const existing = splitsForOne(db, id)
    if (existing.length > 1) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Change the split lines too — they no longer add up to the new amount',
      })
    }
    setSplits(db, id, updated.amountMinor, singleSplit({
      amountMinor: updated.amountMinor,
      categoryId: existing[0]?.categoryId ?? null,
      categorizedBy: 'user',
    }))
  }

  return updated
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

/**
 * Spend per category over a half-open window. Excludes pending rows.
 *
 * THE single category aggregation in the app — every consumer (budgets, the
 * overview totals) goes through this one function, which is why splitting a
 * transaction across categories needed no changes above this line: the return
 * shape is unchanged, the numbers just come from split lines now.
 *
 * `count(distinct transaction_id)`, NOT `count(*)`: a receipt with two lines in
 * the same category is still one transaction, and there is deliberately no
 * unique index stopping that.
 */
export function spendByCategory(db: Db, householdId: string, start: string, end: string) {
  return db.select({
    categoryId: financeTransactionSplits.categoryId,
    currency: financeTransactions.currency,
    totalMinor: sql<number>`sum(${financeTransactionSplits.amountMinor})`,
    n: sql<number>`count(distinct ${financeTransactions.id})`,
  })
    .from(financeTransactionSplits)
    .innerJoin(financeTransactions, eq(financeTransactions.id, financeTransactionSplits.transactionId))
    .where(and(
      eq(financeTransactions.householdId, householdId),
      eq(financeTransactions.pending, false),
      gte(financeTransactions.postedDate, start),
      lt(financeTransactions.postedDate, end),
    ))
    .groupBy(financeTransactionSplits.categoryId, financeTransactions.currency)
    .all()
}
