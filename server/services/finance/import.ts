import { and, eq, gte, lte } from 'drizzle-orm'
import { addDaysToDateString } from '#shared/utils/dates'
import type { Db } from '../../db/client'
import { financeImportBatches, financeTransactions } from '../../db/schema'
import { getAccount } from './accounts'
import {
  detectFormat, parseCsvStatement, parseOfx, type CsvColumnMap, type DateOrder, type ParsedRow,
} from './parseFile'
import { applyRules, listRules } from './rules'
import { dedupeHashFor } from './transactions'
import { setSplits, singleSplit } from './splits'

export interface ImportCandidate extends ParsedRow {
  index: number
  /** Rows that look like something already on the ledger. */
  duplicateOf: { id: string, description: string, postedDate: string, source: string } | null
}

export interface ImportPreview {
  format: 'ofx' | 'qfx' | 'csv'
  rows: ImportCandidate[]
  warnings: string[]
  duplicateCount: number
  columnMap?: Partial<CsvColumnMap>
}

/** ±3 days: a card charge often posts a day or two after the statement date. */
const DUPLICATE_WINDOW_DAYS = 3

function parse(args: { filename: string, content: string, columnMap?: Partial<CsvColumnMap>, hasHeader?: boolean, dateFormat?: DateOrder, currency: string }) {
  const format = detectFormat(args.filename, args.content)
  const result = format === 'csv'
    ? parseCsvStatement(args.content, {
        columnMap: args.columnMap,
        hasHeader: args.hasHeader,
        dateFormat: args.dateFormat,
        currency: args.currency,
      })
    : parseOfx(args.content)
  return { format, result }
}

/**
 * Finds rows that look like they are already on the ledger.
 *
 * Deliberately a *review* step, not an auto-drop. Two identical $5 coffees on
 * one day are both real, and silently discarding the second is a bug the user
 * cannot see. So: same account, same exact amount, description matching after
 * normalisation, within a few days — and the user decides.
 */
export function previewImport(db: Db, args: {
  householdId: string
  accountId: string
  filename: string
  content: string
  columnMap?: Partial<CsvColumnMap>
  hasHeader?: boolean
  dateFormat?: DateOrder
}): ImportPreview {
  const account = getAccount(db, args.householdId, args.accountId)
  const { format, result } = parse({ ...args, currency: account.currency })

  const rows: ImportCandidate[] = result.rows.map((row, index) => ({
    ...row,
    index,
    duplicateOf: findDuplicate(db, args.accountId, row),
  }))

  return {
    format,
    rows,
    warnings: result.warnings,
    duplicateCount: rows.filter(r => r.duplicateOf).length,
    ...(format === 'csv' ? { columnMap: args.columnMap } : {}),
  }
}

function findDuplicate(db: Db, accountId: string, row: ParsedRow) {
  // An OFX FITID is authoritative when we already hold one — no fuzziness needed.
  if (row.externalId) {
    const exact = db.select().from(financeTransactions)
      .where(and(
        eq(financeTransactions.accountId, accountId),
        eq(financeTransactions.externalId, row.externalId),
      ))
      .get()
    if (exact) {
      return { id: exact.id, description: exact.description, postedDate: exact.postedDate, source: exact.source }
    }
  }

  const hash = dedupeHashFor({
    accountId,
    postedDate: row.postedDate,
    amountMinor: row.amountMinor,
    description: row.description,
  })
  const near = db.select().from(financeTransactions)
    .where(and(
      eq(financeTransactions.accountId, accountId),
      eq(financeTransactions.amountMinor, row.amountMinor),
      gte(financeTransactions.postedDate, addDaysToDateString(row.postedDate, -DUPLICATE_WINDOW_DAYS)),
      lte(financeTransactions.postedDate, addDaysToDateString(row.postedDate, DUPLICATE_WINDOW_DAYS)),
    ))
    .all()

  // The date is inside a window, so compare on the description hash computed
  // at the CANDIDATE's own date to keep the comparison symmetric.
  const match = near.find(existing => existing.dedupeHash === hash
    || dedupeHashFor({
      accountId,
      postedDate: row.postedDate,
      amountMinor: existing.amountMinor,
      description: existing.description,
    }) === hash)

  return match
    ? { id: match.id, description: match.description, postedDate: match.postedDate, source: match.source }
    : null
}

export function commitImport(db: Db, args: {
  householdId: string
  profileId: string
  accountId: string
  filename: string
  content: string
  columnMap?: Partial<CsvColumnMap>
  hasHeader?: boolean
  dateFormat?: DateOrder
  skipRows: number[]
}): { batchId: string, imported: number, skipped: number } {
  const account = getAccount(db, args.householdId, args.accountId)
  const { format, result } = parse({ ...args, currency: account.currency })
  const skip = new Set(args.skipRows)
  const rules = listRules(db, args.householdId)

  const batch = db.insert(financeImportBatches).values({
    householdId: args.householdId,
    accountId: account.id,
    filename: args.filename,
    format,
    // Remembered so the next statement from the same bank is one click.
    columnMap: (args.columnMap ?? null) as Record<string, string> | null,
    rowCount: result.rows.length,
    createdByProfileId: args.profileId,
  }).returning().get()

  let imported = 0
  for (const [index, row] of result.rows.entries()) {
    if (skip.has(index)) continue

    const effect = applyRules(rules, {
      description: row.description,
      payee: row.payee,
      memo: row.memo,
      accountId: account.id,
    })

    try {
      const created = db.insert(financeTransactions).values({
        householdId: args.householdId,
        accountId: account.id,
        // NOT stored as externalId: that column is scoped to bank sync, and a
        // FITID colliding with a synced id would make the unique index reject
        // a legitimate row. Dedup for imports goes through dedupeHash.
        externalId: null,
        postedAt: new Date(`${row.postedDate}T12:00:00`),
        postedDate: row.postedDate,
        amountMinor: row.amountMinor,
        currency: account.currency,
        currencyExponent: account.currencyExponent,
        description: row.description,
        payee: row.payee ?? effect?.payee ?? null,
        memo: row.memo ?? null,
        pending: false,
        source: 'import',
        importBatchId: batch.id,
        dedupeHash: dedupeHashFor({
          accountId: account.id,
          postedDate: row.postedDate,
          amountMinor: row.amountMinor,
          description: row.description,
        }),
        createdByProfileId: args.profileId,
      }).returning().get()

      setSplits(db, created.id, created.amountMinor, singleSplit({
        amountMinor: created.amountMinor,
        categoryId: effect?.categoryId ?? null,
        categorizedBy: 'import',
      }))
      imported++
    }
    catch {
      // A row that collides with an existing unique key is a skip, not a crash.
      continue
    }
  }

  const skipped = result.rows.length - imported
  db.update(financeImportBatches)
    .set({ importedCount: imported, skippedCount: skipped })
    .where(eq(financeImportBatches.id, batch.id))
    .run()

  return { batchId: batch.id, imported, skipped }
}

export function listImportBatches(db: Db, householdId: string) {
  return db.select().from(financeImportBatches)
    .where(eq(financeImportBatches.householdId, householdId))
    .all()
    .map(b => ({
      id: b.id,
      accountId: b.accountId,
      filename: b.filename,
      format: b.format,
      rowCount: b.rowCount,
      importedCount: b.importedCount,
      skippedCount: b.skippedCount,
      revertedAt: b.revertedAt?.getTime() ?? null,
      createdAt: b.createdAt.getTime(),
    }))
}

/**
 * Undo. A wrong column mapping wrecks a ledger, and without this the fix is
 * hand-deleting 400 rows — which is why the batch row exists at all.
 */
export function revertImportBatch(db: Db, householdId: string, batchId: string): { removed: number } {
  const batch = db.select().from(financeImportBatches)
    .where(and(eq(financeImportBatches.id, batchId), eq(financeImportBatches.householdId, householdId)))
    .get()
  if (!batch) throw createError({ statusCode: 404, statusMessage: 'Import not found' })
  if (batch.revertedAt) throw createError({ statusCode: 409, statusMessage: 'That import was already undone' })

  const removed = db.delete(financeTransactions)
    .where(eq(financeTransactions.importBatchId, batchId))
    .returning({ id: financeTransactions.id })
    .all().length

  db.update(financeImportBatches).set({ revertedAt: new Date() })
    .where(eq(financeImportBatches.id, batchId)).run()
  return { removed }
}
