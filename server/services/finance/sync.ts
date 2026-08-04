import { and, eq, gte, inArray, isNotNull, isNull, or, lte } from 'drizzle-orm'
import { currencyExponent } from '#shared/utils/money'
import { addDaysToDateString, toDateString } from '#shared/utils/dates'
import type { Db } from '../../db/client'
import { financeAccounts, financeConnections, financeTransactions } from '../../db/schema'
import { decryptSecret, encryptSecret } from '../../utils/crypto'
import { dedupeHashFor } from './transactions'
import { rebalanceSplits, setSplits, singleSplit } from './splits'
import { applyRules, listRules } from './rules'
import {
  INITIAL_HISTORY_DAYS, SYNC_OVERLAP_DAYS, SimpleFinReauthError,
  describeSyncError, fetchAccounts, simplefinDebugLog, type SimpleFinAccount,
} from './simplefin'

export type ConnectionRow = typeof financeConnections.$inferSelect

/** Exponential, jittered, capped. The precedent this codebase was missing. */
const MAX_BACKOFF_MS = 24 * 60 * 60_000
const REAUTH_RETRY_MS = 24 * 60 * 60_000

function backoffMs(intervalMinutes: number, consecutiveFailures: number): number {
  const base = intervalMinutes * 60_000
  const raw = Math.min(base * 2 ** Math.max(0, consecutiveFailures - 1), MAX_BACKOFF_MS)
  // ±10% jitter so several connections that broke together don't retry in lockstep.
  return Math.round(raw * (0.9 + Math.random() * 0.2))
}

export function connectionsDue(db: Db, now = new Date()): ConnectionRow[] {
  return db.select().from(financeConnections)
    .where(and(
      or(
        eq(financeConnections.status, 'ok'),
        eq(financeConnections.status, 'partial'),
        eq(financeConnections.status, 'error'),
        eq(financeConnections.status, 'needs_reauth'),
      )!,
      or(isNull(financeConnections.nextAttemptAt), lte(financeConnections.nextAttemptAt, now))!,
    ))
    .all()
}

export interface SyncOutcome {
  connectionId: string
  status: ConnectionRow['status']
  accountsSeen: number
  inserted: number
  updated: number
  removedPending: number
  errors: string[]
  error?: string
}

/**
 * Syncs one connection. NEVER throws: one bad bank must not stop the others,
 * and a task that throws takes down the scheduler tick (the same rule the push
 * dispatcher follows).
 */
export async function syncConnection(db: Db, connection: ConnectionRow): Promise<SyncOutcome> {
  const base: SyncOutcome = {
    connectionId: connection.id,
    status: connection.status,
    accountsSeen: 0,
    inserted: 0,
    updated: 0,
    removedPending: 0,
    errors: [],
  }
  const now = new Date()

  const accessUrl = decryptSecret(connection.accessUrlEnc)
  if (!accessUrl) {
    // Not a network problem, so it must not feed the backoff counter — that
    // would bury the real cause under retry churn. Skip and say so.
    db.update(financeConnections).set({
      status: 'error',
      lastAttemptAt: now,
      lastError: 'The encryption key for this connection is missing or has changed — reconnect this bank.',
      nextAttemptAt: new Date(now.getTime() + REAUTH_RETRY_MS),
    }).where(eq(financeConnections.id, connection.id)).run()
    return { ...base, status: 'error', error: 'credentials unreadable' }
  }

  // Written BEFORE the fetch, unconditionally. Keeping "last tried" separate
  // from "last succeeded" is what stops a broken connection retrying on
  // every single tick forever.
  db.update(financeConnections).set({ lastAttemptAt: now })
    .where(eq(financeConnections.id, connection.id)).run()

  const startDate = connection.lastSyncAt
    ? new Date(connection.lastSyncAt.getTime() - SYNC_OVERLAP_DAYS * 86_400_000)
    : new Date(now.getTime() - INITIAL_HISTORY_DAYS * 86_400_000)

  let result: Awaited<ReturnType<typeof fetchAccounts>>
  try {
    result = await fetchAccounts(accessUrl, { startDate })
  }
  catch (error) {
    const needsReauth = error instanceof SimpleFinReauthError
    const consecutiveFailures = connection.consecutiveFailures + 1
    db.update(financeConnections).set({
      status: needsReauth ? 'needs_reauth' : 'error',
      consecutiveFailures,
      lastError: describeSyncError(error),
      // A connection that needs a human is not worth hammering hourly.
      nextAttemptAt: new Date(now.getTime() + (needsReauth
        ? REAUTH_RETRY_MS
        : backoffMs(connection.syncIntervalMinutes, consecutiveFailures))),
    }).where(eq(financeConnections.id, connection.id)).run()
    return { ...base, status: needsReauth ? 'needs_reauth' : 'error', error: describeSyncError(error) }
  }

  // Ingest must not be able to escape this function. If it threw, the status
  // and nextAttemptAt below would never be written, so the connection would
  // stay due and retry on EVERY tick — the exact hot-loop the backoff exists
  // to prevent, and against a rate-limited bank API that is how you get
  // blocked. A failure here is treated as a failed sync, backoff included.
  const counts = { inserted: 0, updated: 0, removedPending: 0 }
  try {
    for (const account of result.accounts) {
      const applied = ingestAccount(db, connection, account, startDate)
      counts.inserted += applied.inserted
      counts.updated += applied.updated
      counts.removedPending += applied.removedPending
    }
  }
  catch (error) {
    const consecutiveFailures = connection.consecutiveFailures + 1
    db.update(financeConnections).set({
      status: 'error',
      consecutiveFailures,
      lastError: describeSyncError(error),
      nextAttemptAt: new Date(now.getTime() + backoffMs(connection.syncIntervalMinutes, consecutiveFailures)),
    }).where(eq(financeConnections.id, connection.id)).run()
    return { ...base, status: 'error', ...counts, error: describeSyncError(error) }
  }

  const status: ConnectionRow['status'] = result.errors.length ? 'partial' : 'ok'
  db.update(financeConnections).set({
    status,
    consecutiveFailures: 0,
    // On a PARTIAL sync one institution returned nothing, so advancing the
    // watermark to now would move the next fetch window past the gap and lose
    // that bank's transactions permanently. Hold the watermark where it was;
    // re-fetching a window we already have is free, thanks to the unique index.
    ...(status === 'ok' ? { lastSyncAt: now } : {}),
    lastError: null,
    lastErrorList: result.errors.length ? result.errors : null,
    nextAttemptAt: new Date(now.getTime() + connection.syncIntervalMinutes * 60_000),
  }).where(eq(financeConnections.id, connection.id)).run()

  return {
    ...base,
    status,
    accountsSeen: result.accounts.length,
    ...counts,
    errors: result.errors,
  }
}

/** Upserts one account and its transactions. Idempotent by (accountId, externalId). */
export function ingestAccount(
  db: Db,
  connection: ConnectionRow,
  incoming: SimpleFinAccount,
  windowStart: Date,
): { inserted: number, updated: number, removedPending: number } {
  const exponent = currencyExponent(incoming.currency)

  let account = db.select().from(financeAccounts)
    .where(and(
      eq(financeAccounts.connectionId, connection.id),
      eq(financeAccounts.externalId, incoming.externalId),
    ))
    .get()

  if (!account) {
    account = db.insert(financeAccounts).values({
      householdId: connection.householdId,
      connectionId: connection.id,
      externalId: incoming.externalId,
      orgName: incoming.orgName,
      name: incoming.name,
      type: guessAccountType(incoming.name),
      currency: incoming.currency,
      currencyExponent: exponent,
      // The bank owns this number. Never recomputed from transactions.
      balanceSource: 'bank',
      balanceMinor: incoming.balanceMinor ?? 0,
      availableBalanceMinor: incoming.availableBalanceMinor,
      balanceAt: incoming.balanceMinor != null ? incoming.balanceAt : null,
    }).returning().get()
  }
  else {
    db.update(financeAccounts).set({
      orgName: incoming.orgName,
      // A payload with no parseable balance keeps the stored one — including
      // its as-of time, which describes THAT number, not this sync.
      ...(incoming.balanceMinor != null
        ? {
            balanceMinor: incoming.balanceMinor,
            availableBalanceMinor: incoming.availableBalanceMinor,
            balanceAt: incoming.balanceAt,
          }
        : {}),
      currency: incoming.currency,
      currencyExponent: exponent,
    }).where(eq(financeAccounts.id, account.id)).run()
  }

  const accountId = account.id
  const rules = listRules(db, connection.householdId)
  let inserted = 0
  let updated = 0

  for (const txn of incoming.transactions) {
    const postedDate = toDateString(txn.postedAt)
    const existing = db.select().from(financeTransactions)
      .where(and(
        eq(financeTransactions.accountId, accountId),
        eq(financeTransactions.externalId, txn.id),
      ))
      .get()

    if (existing) {
      // Reconcile by externalId only. Fuzzy pending→posted merging (tips
      // change the amount, holds change the date) is a rabbit hole whose
      // failure mode — silently deleting a row somebody categorised — is far
      // worse than the inconvenience of it being a fresh row.
      const changed = existing.amountMinor !== txn.amountMinor
        || existing.description !== txn.description
        || existing.pending !== txn.pending
        || existing.postedDate !== postedDate
      if (changed) {
        db.update(financeTransactions).set({
          amountMinor: txn.amountMinor,
          description: txn.description,
          payee: txn.payee ?? existing.payee,
          memo: txn.memo ?? existing.memo,
          pending: txn.pending,
          postedAt: txn.postedAt,
          postedDate,
        }).where(eq(financeTransactions.id, existing.id)).run()
        // The categorisation is left alone — that is the promise a re-sync
        // makes — but the LINES have to keep summing to the amount, and the
        // bank just changed it. Nothing else touches them.
        if (existing.amountMinor !== txn.amountMinor) {
          rebalanceSplits(db, existing.id, txn.amountMinor)
        }
        updated++
      }
      continue
    }

    const effect = applyRules(rules, {
      description: txn.description,
      payee: txn.payee,
      memo: txn.memo,
      accountId,
    })

    const created = db.insert(financeTransactions).values({
      householdId: connection.householdId,
      accountId,
      externalId: txn.id,
      postedAt: txn.postedAt,
      postedDate,
      amountMinor: txn.amountMinor,
      currency: incoming.currency,
      currencyExponent: exponent,
      description: txn.description,
      payee: txn.payee ?? effect?.payee ?? null,
      memo: txn.memo,
      pending: txn.pending,
      source: 'sync',
      dedupeHash: dedupeHashFor({ accountId, postedDate, amountMinor: txn.amountMinor, description: txn.description }),
    }).returning().get()

    // One line carrying the whole amount. Re-syncing an existing transaction
    // never touches its splits, so a receipt somebody divided by hand survives
    // every future sync — same guarantee the old categoryId column had.
    setSplits(db, created.id, created.amountMinor, singleSplit({
      amountMinor: created.amountMinor,
      categoryId: effect?.categoryId ?? null,
      categorizedBy: 'rule',
    }))
    inserted++
  }

  // A pending row inside the re-fetched window that the bank no longer lists
  // is genuinely gone (cancelled hold, dropped auth). Safe *because* the
  // window always overlaps — outside it we have no opinion.
  //
  // Two guards on that reasoning:
  //  - An account that returned NO transactions tells us nothing. It happens
  //    when an institution is having a bad day, and treating it as "everything
  //    was cancelled" would wipe every pending row the family could see.
  //  - The floor is the day AFTER windowStart. windowStart is an instant, but
  //    postedDate is a calendar date, so a row dated on the boundary day may
  //    sit before the instant the bank was actually asked about — outside the
  //    window, where we have no opinion.
  let stale: typeof financeTransactions.$inferSelect[] = []
  if (incoming.transactions.length) {
    const seen = new Set(incoming.transactions.map(t => t.id))
    const floor = addDaysToDateString(toDateString(windowStart), 1)
    stale = db.select().from(financeTransactions)
      .where(and(
        eq(financeTransactions.accountId, accountId),
        eq(financeTransactions.pending, true),
        eq(financeTransactions.source, 'sync'),
        isNotNull(financeTransactions.externalId),
        gte(financeTransactions.postedDate, floor),
      ))
      .all()
      .filter(row => !seen.has(row.externalId!))

    if (stale.length) {
      db.delete(financeTransactions).where(inArray(financeTransactions.id, stale.map(r => r.id))).run()
    }
  }

  simplefinDebugLog(
    `ingested "${incoming.name}" (${incoming.externalId}): `
    + (incoming.balanceMinor != null
      ? `stored balance ${incoming.balanceMinor} minor`
      : `no balance in payload — kept stored ${account.balanceMinor} minor`)
    + `, ${inserted} inserted, ${updated} updated, ${stale.length} pending removed`,
  )
  return { inserted, updated, removedPending: stale.length }
}

/** Best-effort, and always overridable in the UI — SimpleFIN has no type field. */
function guessAccountType(name: string): 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'other' {
  const n = name.toLowerCase()
  if (/(credit|card|visa|mastercard|amex)/.test(n)) return 'credit'
  if (/(saving|money market|msa|hsa)/.test(n)) return 'savings'
  if (/(401|ira|brokerage|invest)/.test(n)) return 'investment'
  if (/(loan|mortgage|auto)/.test(n)) return 'loan'
  if (/(check|debit)/.test(n)) return 'checking'
  return 'other'
}

export function storeAccessUrl(accessUrl: string): string {
  return encryptSecret(accessUrl)
}

/** Whether the stored credentials can still be read with the current key. */
export function credentialsReadable(connection: ConnectionRow): boolean {
  return decryptSecret(connection.accessUrlEnc) !== null
}
