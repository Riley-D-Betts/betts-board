import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { createdAt, id, updatedAt } from './_helpers'
import { households } from './household'
import { profiles } from './profiles'

/**
 * Finance is the first slice in this app that isn't shareable. Everything else
 * assumes "anyone at the tablet is family, and family sees everything" — which
 * is right for chores and dinner, and wrong for bank balances.
 *
 * MONEY IS ALWAYS INTEGER MINOR UNITS + A CURRENCY CODE. Never a float, never
 * a decimal string in an arithmetic path. `shared/utils/money.ts` is the only
 * door in from the outside world. `currencyExponent` rides along per account
 * because ¥1000 is 1000 minor units, not 100000, and discovering that after
 * six months of history is not a fixable mistake.
 */

// ── Access control ────────────────────────────────────────────────────────

/**
 * Who may see the money. Deliberately NOT `profiles.role` — household admin is
 * a convenience role that anyone can assume by tapping a profile picture
 * (POST /api/auth/profile takes no credential), so it is not a boundary.
 * The PIN itself lives in `profiles.pinHash`, which the schema has always had.
 */
export const financeMembers = sqliteTable('finance_members', {
  profileId: text('profile_id').primaryKey().references(() => profiles.id, { onDelete: 'cascade' }),
  householdId: text('household_id').notNull().references(() => households.id),
  // owner: connect/disconnect banks, manage members, delete data.
  // member: read, categorise, edit budgets/bills/goals.
  role: text('role', { enum: ['owner', 'member'] }).notNull().default('member'),
  // Persisted, not in-memory: the existing rate limiter is IP-keyed and resets
  // on restart, which on a LAN box means "restart to reset your attempts".
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
  // Surfaced in the UI. For a family, noticing beats preventing.
  failedSinceLastUnlock: integer('failed_since_last_unlock').notNull().default(0),
  lastUnlockAt: integer('last_unlock_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
})

/**
 * The unlocked-finance claim. It lives here rather than in the sealed cookie
 * because nuxt-auth-utils merges session writes with defu: a top-level cookie
 * claim SURVIVES `POST /api/auth/profile`, so Dad unlocking and a kid then
 * switching profiles would inherit the unlock. Worse, the obvious way to clear
 * it (`{ finance: null }`) is a no-op — defu skips null sources. Measured, not
 * assumed; tests/unit/financeSessionMerge.spec.ts pins that behaviour.
 *
 * So: the cookie carries only an opaque nonce, and every authoritative fact
 * (expiry, revocation, which profile) is a column here. Lock is one DELETE.
 */
export const financeSessions = sqliteTable('finance_sessions', {
  id: id(),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  // sha256 of a 256-bit random value — not argon2. Same reasoning as API keys:
  // slow hashes exist to make low-entropy guesses expensive, and this isn't one.
  nonceHash: text('nonce_hash').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
  deviceLabel: text('device_label'),
  createdAt: createdAt(),
}, table => [
  uniqueIndex('finance_sessions_nonce_unique').on(table.nonceHash),
  index('finance_sessions_profile_idx').on(table.profileId),
])

// ── Bank connections ──────────────────────────────────────────────────────

export const financeConnections = sqliteTable('finance_connections', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  provider: text('provider', { enum: ['simplefin'] }).notNull().default('simplefin'),
  nickname: text('nickname'),
  /**
   * AES-256-GCM envelope (server/utils/crypto.ts). The plaintext is a URL with
   * inline basic-auth credentials granting read access to the family's whole
   * bank history — a higher-value secret than the household password. Never
   * log it, never return it to a client, never let it reach `lastError`.
   * The setup token is claimed in-request and never stored at all.
   */
  accessUrlEnc: text('access_url_enc').notNull(),
  status: text('status', {
    enum: ['ok', 'partial', 'error', 'needs_reauth', 'disabled'],
  }).notNull().default('ok'),
  syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(360),
  // lastAttemptAt and lastSyncAt are SEPARATE on purpose. Conflating "when did
  // we last try" with "when did we last succeed" is exactly what makes the ICS
  // feed refresher retry a broken feed every tick forever; against a
  // rate-limited bank API that is how you get blocked.
  lastAttemptAt: integer('last_attempt_at', { mode: 'timestamp_ms' }),
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp_ms' }),
  nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  /** Already redacted and sanitised before it lands here. */
  lastError: text('last_error'),
  /** SimpleFIN's per-institution `errlist` — partial failure is the normal case. */
  lastErrorList: text('last_error_list', { mode: 'json' }).$type<string[]>(),
  createdByProfileId: text('created_by_profile_id').references(() => profiles.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [index('finance_connections_next_attempt_idx').on(table.nextAttemptAt)])

// ── Accounts and transactions ─────────────────────────────────────────────

export const financeAccounts = sqliteTable('finance_accounts', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  /** Null ⇒ a manual account the family keeps by hand. */
  connectionId: text('connection_id').references(() => financeConnections.id, { onDelete: 'cascade' }),
  externalId: text('external_id'),
  orgName: text('org_name'),
  name: text('name').notNull(),
  type: text('type', {
    enum: ['checking', 'savings', 'credit', 'cash', 'investment', 'loan', 'other'],
  }).notNull().default('checking'),
  currency: text('currency').notNull().default('USD'),
  currencyExponent: integer('currency_exponent').notNull().default(2),
  /**
   * bank  — the balance is whatever the bank last said; never recompute it from
   *         transactions, because SimpleFIN only guarantees a window of history
   *         and a summed balance would be confidently wrong.
   * ledger — a manual account: balance IS opening balance plus the rows.
   */
  balanceSource: text('balance_source', { enum: ['bank', 'ledger'] }).notNull().default('ledger'),
  balanceMinor: integer('balance_minor').notNull().default(0),
  availableBalanceMinor: integer('available_balance_minor'),
  balanceAt: integer('balance_at', { mode: 'timestamp_ms' }),
  isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
  includeInNetWorth: integer('include_in_net_worth', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [
  uniqueIndex('finance_accounts_external_unique').on(table.connectionId, table.externalId),
  index('finance_accounts_household_idx').on(table.householdId),
])

export const financeCategories = sqliteTable('finance_categories', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['expense', 'income', 'transfer'] }).notNull().default('expense'),
  icon: text('icon'),
  color: text('color'),
  parentId: text('parent_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
}, table => [index('finance_categories_household_idx').on(table.householdId)])

export const financeImportBatches = sqliteTable('finance_import_batches', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  accountId: text('account_id').notNull().references(() => financeAccounts.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  format: text('format', { enum: ['ofx', 'qfx', 'csv'] }).notNull(),
  /** Remembered so the next import from the same bank is one click. */
  columnMap: text('column_map', { mode: 'json' }).$type<Record<string, string>>(),
  rowCount: integer('row_count').notNull().default(0),
  importedCount: integer('imported_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  /** Set when the batch is rolled back; rows are deleted, the record is kept. */
  revertedAt: integer('reverted_at', { mode: 'timestamp_ms' }),
  createdByProfileId: text('created_by_profile_id').references(() => profiles.id),
  createdAt: createdAt(),
}, table => [index('finance_import_batches_account_idx').on(table.accountId)])

export const financeTransactions = sqliteTable('finance_transactions', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  accountId: text('account_id').notNull().references(() => financeAccounts.id, { onDelete: 'cascade' }),
  /** Bank's own id. Null for manual and file-imported rows. */
  externalId: text('external_id'),
  postedAt: integer('posted_at', { mode: 'timestamp_ms' }).notNull(),
  /** YYYY-MM-DD in the household calendar — what budgets and bills group by. */
  postedDate: text('posted_date').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  // Denormalised so renaming an account's currency never rewrites history.
  currency: text('currency').notNull().default('USD'),
  currencyExponent: integer('currency_exponent').notNull().default(2),
  description: text('description').notNull(),
  payee: text('payee'),
  memo: text('memo'),
  pending: integer('pending', { mode: 'boolean' }).notNull().default(false),
  categoryId: text('category_id').references(() => financeCategories.id, { onDelete: 'set null' }),
  /** A user's choice must survive re-sync and re-running rules. */
  categorizedBy: text('categorized_by', { enum: ['rule', 'user', 'import'] }),
  notes: text('notes'),
  source: text('source', { enum: ['sync', 'import', 'manual'] }).notNull().default('manual'),
  importBatchId: text('import_batch_id').references(() => financeImportBatches.id, { onDelete: 'set null' }),
  /** Candidate-finder for import dedup. NOT unique — two $5 coffees are both real. */
  dedupeHash: text('dedupe_hash'),
  createdByProfileId: text('created_by_profile_id').references(() => profiles.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [
  // The idempotent-ingest guarantee: re-fetching an overlapping window is free.
  // SQLite treats NULLs as distinct here, so manual and imported rows never
  // collide with each other or block ingest.
  uniqueIndex('finance_txn_external_unique').on(table.accountId, table.externalId),
  index('finance_txn_account_posted_idx').on(table.accountId, table.postedDate),
  index('finance_txn_household_posted_idx').on(table.householdId, table.postedDate),
  index('finance_txn_dedupe_idx').on(table.accountId, table.dedupeHash),
])

/**
 * Auto-categorisation. Deliberately no regex option: Node has no way to time
 * out a runaway pattern, and contains/startsWith/equals covers what families
 * actually write.
 */
export const financeRules = sqliteTable('finance_rules', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  priority: integer('priority').notNull().default(0),
  matchField: text('match_field', { enum: ['description', 'payee', 'memo'] }).notNull().default('description'),
  matchType: text('match_type', { enum: ['contains', 'startsWith', 'equals'] }).notNull().default('contains'),
  matchValue: text('match_value').notNull(),
  /** Null = applies to every account. */
  accountId: text('account_id').references(() => financeAccounts.id, { onDelete: 'cascade' }),
  setCategoryId: text('set_category_id').references(() => financeCategories.id, { onDelete: 'cascade' }),
  setPayee: text('set_payee'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
}, table => [index('finance_rules_household_idx').on(table.householdId, table.priority)])

// ── Planning ──────────────────────────────────────────────────────────────

/**
 * One row per category per month. Not a category-level amount with an
 * effective-from date: changing March must not rewrite January, and a family
 * reading last year's budget should see what it actually was.
 */
export const financeBudgets = sqliteTable('finance_budgets', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  categoryId: text('category_id').notNull().references(() => financeCategories.id, { onDelete: 'cascade' }),
  /** YYYY-MM. Monthly only in v1 — weekly and annual periods are a UI trap. */
  periodStart: text('period_start').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull().default('USD'),
  rollover: integer('rollover', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [
  uniqueIndex('finance_budgets_unique').on(table.householdId, table.categoryId, table.periodStart),
])

/**
 * Bills live here and ONLY here — never in the `events` table. Three reasons,
 * each sufficient: the ICS export route hands the whole calendar to anyone
 * holding a token every unlocked client already has; GET /api/calendar is
 * `requireUnlocked` and feeds the wall display; and events carry attendees and
 * reminders that mean nothing for a bill.
 *
 * Recurrence is a bare date-only RRULE expanded through the calendar service,
 * exactly like chores — the rrule package is still imported in one place.
 */
export const financeBills = sqliteTable('finance_bills', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  name: text('name').notNull(),
  /** Income is its own kind rather than a negative expense — cleaner forecasts. */
  kind: text('kind', { enum: ['expense', 'income'] }).notNull().default('expense'),
  categoryId: text('category_id').references(() => financeCategories.id, { onDelete: 'set null' }),
  /** Estimated: the real amount arrives with the transaction. */
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull().default('USD'),
  rrule: text('rrule'),
  /** YYYY-MM-DD, never timezone-converted. */
  startDate: text('start_date').notNull(),
  recurrenceEnd: text('recurrence_end'),
  accountId: text('account_id').references(() => financeAccounts.id, { onDelete: 'set null' }),
  autoPay: integer('auto_pay', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [index('finance_bills_household_idx').on(table.householdId)])

/**
 * Materialised only when someone acts on an occurrence — the same shape as
 * event exceptions: expansion is virtual, deviations are rows.
 */
export const financeBillPayments = sqliteTable('finance_bill_payments', {
  id: id(),
  billId: text('bill_id').notNull().references(() => financeBills.id, { onDelete: 'cascade' }),
  /** YYYY-MM-DD of the occurrence this row overrides. */
  dueDate: text('due_date').notNull(),
  status: text('status', { enum: ['paid', 'skipped'] }).notNull(),
  paidAt: integer('paid_at', { mode: 'timestamp_ms' }),
  amountMinor: integer('amount_minor'),
  transactionId: text('transaction_id').references(() => financeTransactions.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, table => [uniqueIndex('finance_bill_payments_unique').on(table.billId, table.dueDate)])

export const financeGoals = sqliteTable('finance_goals', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  name: text('name').notNull(),
  targetMinor: integer('target_minor').notNull(),
  currency: text('currency').notNull().default('USD'),
  /** YYYY-MM-DD. Null = no deadline, just a target. */
  targetDate: text('target_date'),
  /** Linked ⇒ progress is the account balance; unlinked ⇒ manual contributions. */
  accountId: text('account_id').references(() => financeAccounts.id, { onDelete: 'set null' }),
  icon: text('icon'),
  color: text('color'),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [index('finance_goals_household_idx').on(table.householdId)])

export const financeGoalContributions = sqliteTable('finance_goal_contributions', {
  id: id(),
  goalId: text('goal_id').notNull().references(() => financeGoals.id, { onDelete: 'cascade' }),
  amountMinor: integer('amount_minor').notNull(),
  /** YYYY-MM-DD. */
  contributedOn: text('contributed_on').notNull(),
  note: text('note'),
  createdByProfileId: text('created_by_profile_id').references(() => profiles.id),
  createdAt: createdAt(),
}, table => [index('finance_goal_contributions_goal_idx').on(table.goalId)])
