import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../../utils/dataDir'

/**
 * Household-wide brute-force lockout for the lock screen.
 *
 * Why a second counter on top of the per-IP bucket: the bucket is per key, and
 * an attacker with many source addresses (a botnet, a VPS with a /64, or just
 * a LAN device changing its address) gets a fresh bucket for each one. There is
 * exactly ONE household password, so the counter that actually protects it has
 * to be per household: consecutive failures from every source add up.
 *
 * Shape deliberately mirrors the finance PIN lockout in
 * server/services/finance/access.ts — escalating steps, persisted, cleared by a
 * success — so there is one lockout idea in this codebase rather than two.
 * Finance can keep its state on the member row it already owns; the household
 * password has no such row, so the state is a small JSON file in the data
 * volume, next to the database it would otherwise be a column of. Persisted for
 * the same reason finance is: an in-memory counter resets on every deploy, and
 * "restart the container" must not be a way to clear a brute-force lockout.
 *
 * DENIAL OF SERVICE — the thing that makes this different from the finance PIN.
 * Anyone who can reach the login page can drive this counter, and being locked
 * out here means the family cannot use their own kitchen tablet. So the delay
 * is CAPPED AT 15 MINUTES (LOCKOUT_STEPS below), never escalating to hours and
 * never permanent: a stranger can make the board annoying, not unusable, and
 * the worst sustained case is a wait shorter than the walk to a laptop. Fifteen
 * minutes is still brutal for guessing — past the top step each further wrong
 * password re-arms the full 15, so a sustained attack gets ~96 guesses a day
 * against a password that is never sent in the clear.
 *
 * The first step is deliberately far out (10 failures) and short (1 minute), so
 * a family member fumbling a password on a phone keyboard never meets it.
 */

/** Descending, like finance's: the first match wins. The top entry is the cap. */
const LOCKOUT_STEPS: { after: number, ms: number }[] = [
  { after: 30, ms: 15 * 60_000 },
  { after: 20, ms: 5 * 60_000 },
  { after: 10, ms: 60_000 },
]

/** Nothing may ever produce a longer lock than the top step, corrupt state included. */
const MAX_LOCKOUT_MS = LOCKOUT_STEPS[0]!.ms

const STATE_FILE = 'unlock-lockout.json'

export interface UnlockLockoutState {
  /** Consecutive failures across every source since the last success. */
  failures: number
  /** Epoch ms; 0 when not locked. */
  lockedUntil: number
}

/**
 * The file is the durable copy; this is the working copy. One process owns the
 * file (one container, one SQLite file), so the cache cannot go stale.
 */
let cached: UnlockLockoutState | null = null

function statePath(): string {
  return join(dataDir(), STATE_FILE)
}

function sanitise(raw: Partial<UnlockLockoutState> | null | undefined, now: number): UnlockLockoutState {
  const failures = Math.max(0, Math.floor(Number(raw?.failures)) || 0)
  const lockedUntil = Math.max(0, Math.floor(Number(raw?.lockedUntil)) || 0)
  return {
    failures,
    // Clamp forwards too: a corrupt or hand-edited file must not be able to
    // lock the family out for a century.
    lockedUntil: Math.min(lockedUntil, now + MAX_LOCKOUT_MS),
  }
}

function load(now: number): UnlockLockoutState {
  if (cached) return cached
  try {
    cached = sanitise(JSON.parse(readFileSync(statePath(), 'utf8')), now)
  }
  catch {
    // Missing on first boot, unreadable if the volume is odd — either way the
    // safe default is "no failures yet", never "locked".
    cached = { failures: 0, lockedUntil: 0 }
  }
  return cached
}

function save(state: UnlockLockoutState) {
  cached = state
  try {
    const path = statePath()
    const tmp = `${path}.tmp`
    // Write-then-rename: a crash mid-write must not leave a truncated file that
    // parses as "no failures" and silently disables the lockout.
    writeFileSync(tmp, JSON.stringify(state))
    renameSync(tmp, path)
  }
  catch {
    // A read-only data volume degrades this to an in-memory lockout for this
    // boot rather than taking the unlock route down.
  }
}

/** Milliseconds the household is locked out for, or 0. */
export function unlockLockoutRemainingMs(now = Date.now()): number {
  const state = load(now)
  return state.lockedUntil > now ? state.lockedUntil - now : 0
}

export function unlockLockoutState(now = Date.now()): UnlockLockoutState {
  return { ...load(now) }
}

/** Count one wrong household password, and lock if that crossed a step. */
export function recordUnlockFailure(now = Date.now()): UnlockLockoutState {
  const state = load(now)
  const failures = state.failures + 1
  const step = LOCKOUT_STEPS.find(s => failures >= s.after)
  const next: UnlockLockoutState = {
    failures,
    lockedUntil: step ? now + Math.min(step.ms, MAX_LOCKOUT_MS) : state.lockedUntil,
  }
  save(next)
  return next
}

/** A correct password proves the guesser is family. Wipe the slate. */
export function clearUnlockFailures(): void {
  save({ failures: 0, lockedUntil: 0 })
}

/** Exported so tests assert against the real policy, not a copy of it. */
export const UNLOCK_LOCKOUT_STEPS = LOCKOUT_STEPS
export const UNLOCK_MAX_LOCKOUT_MS = MAX_LOCKOUT_MS
