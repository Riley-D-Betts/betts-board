import { z } from 'zod'
import { zHexColor, zId } from './common'

/** YYYY-MM-DD calendar date. Never timezone-converted (CLAUDE.md). */
const zDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
/** YYYY-MM budget period. */
const zMonthString = z.string().regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM')

/**
 * ISO 4217, or an opaque identifier. SimpleFIN permits a URL here for
 * non-ISO assets, so anything that isn't three letters is stored verbatim and
 * treated as opaque rather than crashing the sync.
 */
export const zCurrency = z.string().trim().min(1).max(120)

/** Integer minor units. A float here would be a silent money bug. */
export const zAmountMinor = z.number().int().safe()

// ── Access ────────────────────────────────────────────────────────────────

/**
 * Six characters minimum, letters allowed. A four-digit PIN on a box sitting
 * on a home LAN is about 13 bits; with the lockout schedule that is still a
 * week's work for someone who lives in the house.
 */
/** Bounds live here so the keypad enforces exactly what the server does. */
export const PIN_MIN_LENGTH = 6
export const PIN_MAX_LENGTH = 64

export const zPin = z.string().min(PIN_MIN_LENGTH).max(PIN_MAX_LENGTH)

export const financeUnlockSchema = z.object({
  pin: zPin,
  /** Shown in the active-sessions list so an unexpected one is noticeable. */
  deviceLabel: z.string().trim().max(60).optional(),
})

export const financePinSetSchema = z.object({
  pin: zPin,
  /** Required when changing an existing PIN; omitted when setting the first. */
  currentPin: zPin.optional(),
})

export const financeMemberAddSchema = z.object({
  profileId: zId,
  pin: zPin,
  role: z.enum(['owner', 'member']).default('member'),
})

export const financeMemberPatchSchema = z.object({
  role: z.enum(['owner', 'member']),
})

// ── Accounts ──────────────────────────────────────────────────────────────

export const financeAccountTypes = ['checking', 'savings', 'credit', 'cash', 'investment', 'loan', 'other'] as const

export const financeAccountCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(financeAccountTypes).default('checking'),
  /** Omitted = the household's currency, resolved server-side. Not 'USD'. */
  currency: zCurrency.optional(),
  openingBalanceMinor: zAmountMinor.default(0),
  includeInNetWorth: z.boolean().default(true),
})

export const financeAccountPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  type: z.enum(financeAccountTypes).optional(),
  isHidden: z.boolean().optional(),
  includeInNetWorth: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  archived: z.boolean().optional(),
  /** Manual (ledger) accounts only — a synced balance is the bank's to state. */
  balanceMinor: zAmountMinor.optional(),
})

// ── Transactions ──────────────────────────────────────────────────────────

/**
 * One line of a transaction's categorisation.
 *
 * Every transaction has at least one; an ordinary one has exactly one carrying
 * the whole amount, which is why `splits` is optional everywhere below. The
 * lines must sum to the transaction exactly — that is checked server-side
 * against the amount, which a schema on its own cannot see.
 */
export const financeSplitInputSchema = z.object({
  categoryId: zId.nullish(),
  amountMinor: zAmountMinor,
  note: z.string().trim().max(200).nullish(),
})

/** 40 lines is far past any real receipt and stops a runaway client. */
const zSplits = z.array(financeSplitInputSchema).min(1).max(40)

export const financeTransactionCreateSchema = z.object({
  accountId: zId,
  postedDate: zDateString,
  amountMinor: zAmountMinor,
  description: z.string().trim().min(1).max(200),
  payee: z.string().trim().max(120).nullish(),
  memo: z.string().trim().max(500).nullish(),
  categoryId: zId.nullish(),
  notes: z.string().trim().max(2000).nullish(),
  /** Omitted = one line for the whole amount, using `categoryId`. */
  splits: zSplits.optional(),
})

export const financeTransactionPatchSchema = z.object({
  postedDate: zDateString.optional(),
  amountMinor: zAmountMinor.optional(),
  description: z.string().trim().min(1).max(200).optional(),
  payee: z.string().trim().max(120).nullish(),
  memo: z.string().trim().max(500).nullish(),
  categoryId: zId.nullish(),
  notes: z.string().trim().max(2000).nullish(),
  /** Replaces the whole set. Sending one line un-splits a split transaction. */
  splits: zSplits.optional(),
})

export const financeTransactionQuerySchema = z.object({
  accountId: zId.optional(),
  categoryId: zId.optional(),
  /** Half-open window, matching the calendar convention. */
  start: zDateString.optional(),
  end: zDateString.optional(),
  q: z.string().trim().max(120).optional(),
  uncategorized: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

// ── Categories and rules ──────────────────────────────────────────────────

export const financeCategoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['expense', 'income', 'transfer']).default('expense'),
  icon: z.string().trim().max(60).nullish(),
  color: zHexColor.nullish(),
  parentId: zId.nullish(),
})

export const financeCategoryPatchSchema = financeCategoryCreateSchema.partial().extend({
  sortOrder: z.number().int().min(0).max(9999).optional(),
  archived: z.boolean().optional(),
})

export const financeRuleCreateSchema = z.object({
  matchField: z.enum(['description', 'payee', 'memo']).default('description'),
  // No regex option: Node cannot time out a runaway pattern, and these three
  // cover what families actually write.
  matchType: z.enum(['contains', 'startsWith', 'equals']).default('contains'),
  matchValue: z.string().trim().min(1).max(120),
  accountId: zId.nullish(),
  setCategoryId: zId.nullish(),
  setPayee: z.string().trim().max(120).nullish(),
  priority: z.number().int().min(0).max(9999).default(0),
})

export const financeRulePatchSchema = financeRuleCreateSchema.partial().extend({
  enabled: z.boolean().optional(),
})

export const financeRuleApplySchema = z.object({
  /** Re-run rules over existing rows; only touches uncategorised ones. */
  onlyUncategorized: z.boolean().default(true),
})

// ── Connections ───────────────────────────────────────────────────────────

export const financeConnectSchema = z.object({
  /** Base64 SimpleFIN setup token. Claimed immediately and never stored. */
  setupToken: z.string().trim().min(10).max(4000),
  nickname: z.string().trim().max(60).optional(),
})

export const financeConnectionPatchSchema = z.object({
  nickname: z.string().trim().max(60).nullish(),
  syncIntervalMinutes: z.number().int().min(60).max(1440).optional(),
  enabled: z.boolean().optional(),
})

// ── Import ────────────────────────────────────────────────────────────────

export const financeImportPreviewSchema = z.object({
  accountId: zId,
  filename: z.string().trim().min(1).max(200),
  /** File contents as text. OFX/QFX/CSV are all text formats. */
  content: z.string().min(1).max(20_000_000),
  columnMap: z.record(z.string(), z.string()).optional(),
  /** CSV only: which row the data starts on when there's no header. */
  hasHeader: z.boolean().default(true),
  dateFormat: z.enum(['auto', 'MDY', 'DMY', 'YMD']).default('auto'),
})

export const financeImportCommitSchema = financeImportPreviewSchema.extend({
  /** Indices (into the parsed rows) the user chose to skip as duplicates. */
  skipRows: z.array(z.number().int().min(0)).default([]),
})

// ── Planning ──────────────────────────────────────────────────────────────

export const financeBudgetSetSchema = z.object({
  categoryId: zId,
  periodStart: zMonthString,
  amountMinor: zAmountMinor.min(0),
  rollover: z.boolean().default(false),
})

export const financeBudgetQuerySchema = z.object({
  periodStart: zMonthString.optional(),
})

export const financeBillCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['expense', 'income']).default('expense'),
  categoryId: zId.nullish(),
  amountMinor: zAmountMinor.min(0),
  /** Bare RRULE body, no DTSTART — the same contract as events and chores. */
  rrule: z.string().trim().max(500).nullish(),
  startDate: zDateString,
  recurrenceEnd: zDateString.nullish(),
  accountId: zId.nullish(),
  autoPay: z.boolean().default(false),
  notes: z.string().trim().max(2000).nullish(),
})

export const financeBillPatchSchema = financeBillCreateSchema.partial().extend({
  archived: z.boolean().optional(),
})

export const financeBillMarkSchema = z.object({
  dueDate: zDateString,
  status: z.enum(['paid', 'skipped']),
  amountMinor: zAmountMinor.optional(),
  transactionId: zId.nullish(),
})

export const financeBillQuerySchema = z.object({
  start: zDateString,
  /** Exclusive, matching the calendar convention. */
  end: zDateString,
})

export const financeGoalCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  targetMinor: zAmountMinor.min(1),
  targetDate: zDateString.nullish(),
  accountId: zId.nullish(),
  icon: z.string().trim().max(60).nullish(),
  color: zHexColor.nullish(),
})

export const financeGoalPatchSchema = financeGoalCreateSchema.partial().extend({
  archived: z.boolean().optional(),
})

export const financeGoalContributeSchema = z.object({
  amountMinor: zAmountMinor,
  contributedOn: zDateString,
  note: z.string().trim().max(200).nullish(),
})

// ── Forecast ──────────────────────────────────────────────────────────────

export const financeForecastQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(90),
})

// ── Client-facing types ───────────────────────────────────────────────────

export interface FinanceSessionState {
  /** Is this profile a finance member at all? */
  enrolled: boolean
  /**
   * Member, but with no PIN set — i.e. BETTS_RESET_FINANCE_PIN cleared it.
   * Without this the lock screen shows an unlock form that can never succeed,
   * because unlockFinance refuses a profile whose pinHash is null. The
   * documented recovery path would be unreachable from the app.
   */
  needsPin: boolean
  unlocked: boolean
  role: 'owner' | 'member' | null
  /** Epoch ms; drives the countdown and the auto-lock. */
  expiresAt: number | null
  /** Null until finance is set up by anyone. */
  ownerName: string | null
  /** Set up by anyone yet? Drives the trust-on-first-use copy. */
  configured: boolean
  /** Failed unlocks since this profile last got in. Detection beats prevention. */
  failedSinceLastUnlock: number
  lockedUntil: number | null
  /** BETTS_RESET_FINANCE_PIN was used on this boot and nobody has re-enrolled. */
  resetArmed: boolean
}
