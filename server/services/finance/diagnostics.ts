import { eq, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { financeConnections, financeTransactions } from '../../db/schema'
import { listAccounts } from './accounts'
import { decryptSecret } from '../../utils/crypto'
import { INITIAL_HISTORY_DAYS, SYNC_OVERLAP_DAYS } from './simplefin'

/**
 * A snapshot of everything that decides what the Money tab shows, in one
 * paste-able block.
 *
 * This exists because the failure it was built for — "the balance doesn't match
 * my bank" — leaves no trace anywhere a `console.log` would help. `syncConnection`
 * deliberately never throws: every failure is caught and written to the
 * connection row, so a broken bank prints nothing to the container log and the
 * scheduled task returns a count that looks like success. Meanwhile the numbers
 * themselves are correct at every layer and still disagree with the bank's app,
 * because the bank's `balance` is POSTED and the holds sit in a different
 * column. No single log line catches that; the shape of the whole thing does.
 *
 * What is deliberately NOT in here:
 *   - the access URL, in any form. It carries live basic-auth credentials for
 *     the family's bank data, and this payload is built to be pasted into a
 *     chat window or an issue. Only the bridge HOSTNAME is included, which is
 *     what actually answers "is this box even talking to the right bridge".
 *   - `externalId` on accounts and transactions — the bank's own identifiers.
 *   - transaction descriptions and payees. The counts and the arithmetic are
 *     what diagnose a balance; where somebody had lunch is not.
 */

export interface AccountDiagnostic {
  name: string
  type: string
  currency: string
  balanceSource: 'bank' | 'ledger'
  /** The bank's POSTED balance — what the account list shows as the headline. */
  balanceMinor: number
  /** SimpleFIN's `available-balance`, verbatim. Means different things per account type. */
  availableBalanceMinor: number | null
  pendingCount: number
  pendingMinor: number
  balanceWithPendingMinor: number
  balanceAt: number | null
  transactionCount: number
  syncedCount: number
  newestPostedDate: string | null
  oldestPostedDate: string | null
  isHidden: boolean
  archived: boolean
}

export interface ConnectionDiagnostic {
  nickname: string | null
  provider: string
  status: string
  credentialsReadable: boolean
  /** Hostname only — never the credentialed URL. */
  bridgeHost: string | null
  syncIntervalMinutes: number
  consecutiveFailures: number
  lastAttemptAt: number | null
  lastSyncAt: number | null
  nextAttemptAt: number | null
  lastError: string | null
  lastErrorList: string[] | null
  /** The window the NEXT sync will ask for, derived the same way syncConnection derives it. */
  nextRequest: { startDate: number, pendingRequested: boolean }
  accounts: AccountDiagnostic[]
}

export interface FinanceDiagnostics {
  generatedAt: number
  timezone: string
  /** Manual and file-imported accounts, which have no connection to sit under. */
  unlinkedAccounts: AccountDiagnostic[]
  connections: ConnectionDiagnostic[]
}

/** Hostname of the stored access URL, or null if it cannot be read with the current key. */
function bridgeHostOf(accessUrlEnc: string): string | null {
  const url = decryptSecret(accessUrlEnc)
  if (!url) return null
  try {
    return new URL(url).hostname
  }
  catch {
    // A fixed string, never the raw value — that value carries credentials, and
    // "show the user what we couldn't parse" is how they end up in a paste.
    return '(unparseable)'
  }
}

function transactionStats(db: Db, accountId: string) {
  const row = db.select({
    total: sql<number>`count(*)`,
    synced: sql<number>`sum(case when ${financeTransactions.source} = 'sync' then 1 else 0 end)`,
    newest: sql<string | null>`max(${financeTransactions.postedDate})`,
    oldest: sql<string | null>`min(${financeTransactions.postedDate})`,
  }).from(financeTransactions)
    .where(eq(financeTransactions.accountId, accountId))
    .get()

  return {
    transactionCount: row?.total ?? 0,
    syncedCount: row?.synced ?? 0,
    newestPostedDate: row?.newest ?? null,
    oldestPostedDate: row?.oldest ?? null,
  }
}

export function financeDiagnostics(db: Db, householdId: string, timezone: string): FinanceDiagnostics {
  const now = new Date()

  // includeArchived: a hidden account still syncs and still holds rows, so
  // leaving it out would hide the very account somebody is asking about.
  const accounts = listAccounts(db, householdId, true)

  const describe = (a: (typeof accounts)[number]): AccountDiagnostic => ({
    name: a.name,
    type: a.type,
    currency: a.currency,
    balanceSource: a.balanceSource,
    balanceMinor: a.balanceMinor,
    availableBalanceMinor: a.availableBalanceMinor,
    pendingCount: a.pendingCount,
    pendingMinor: a.pendingMinor,
    balanceWithPendingMinor: a.balanceWithPendingMinor,
    balanceAt: a.balanceAt,
    ...transactionStats(db, a.id),
    isHidden: a.isHidden,
    archived: a.archivedAt != null,
  })

  const connections = db.select().from(financeConnections)
    .where(eq(financeConnections.householdId, householdId)).all()
    .map((c): ConnectionDiagnostic => {
      const linked = accounts.filter(a => a.connectionId === c.id)
      // Mirrors syncConnection's derivation exactly. If this window looks wrong,
      // that is the bug — the request is built from it and nothing else.
      const startDate = c.lastSyncAt
        ? new Date(c.lastSyncAt.getTime() - SYNC_OVERLAP_DAYS * 86_400_000)
        : new Date(now.getTime() - INITIAL_HISTORY_DAYS * 86_400_000)

      return {
        nickname: c.nickname,
        provider: c.provider,
        status: c.status,
        credentialsReadable: decryptSecret(c.accessUrlEnc) !== null,
        bridgeHost: bridgeHostOf(c.accessUrlEnc),
        syncIntervalMinutes: c.syncIntervalMinutes,
        consecutiveFailures: c.consecutiveFailures,
        lastAttemptAt: c.lastAttemptAt?.getTime() ?? null,
        lastSyncAt: c.lastSyncAt?.getTime() ?? null,
        nextAttemptAt: c.nextAttemptAt?.getTime() ?? null,
        lastError: c.lastError,
        lastErrorList: c.lastErrorList,
        // Constant today, and stated rather than assumed: "are we even asking
        // for pending rows" was a real question once, and the answer was no.
        nextRequest: { startDate: startDate.getTime(), pendingRequested: true },
        accounts: linked.map(describe),
      }
    })

  return {
    generatedAt: now.getTime(),
    timezone,
    unlinkedAccounts: accounts.filter(a => !a.connectionId).map(describe),
    connections,
  }
}
