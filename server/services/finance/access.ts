import { hash, verify } from '@node-rs/argon2'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { eq, lt } from 'drizzle-orm'
import type { FinanceSessionState } from '#shared/schemas/finance'
import { useDb } from '../../db/client'
import { financeMembers, financeSessions, profiles } from '../../db/schema'
import { requireHousehold, requireProfile } from '../../utils/session'

/**
 * The finance access boundary.
 *
 * Why this exists at all: every other slice is happy with "anyone holding the
 * household password is family". Finance can't be, because switching profiles
 * takes no credential — `POST /api/auth/profile` is `requireUnlocked` and
 * writes whatever role it likes into the session. So `requireAdmin` guards
 * against unbound API keys and accidents, not against a person at the tablet.
 * `requireAdmin` therefore appears nowhere under server/api/finance/, and a
 * unit test asserts that.
 *
 * Why the claim is not just a cookie field: nuxt-auth-utils merges session
 * writes with defu, so a top-level claim SURVIVES a profile switch, and
 * clearing it with `{ finance: null }` silently does nothing (defu skips null
 * sources). Both measured. The cookie therefore carries only an opaque nonce;
 * the database row is the authority for who, until when, and whether at all.
 * Lock and revoke become a DELETE, immune to merge semantics.
 */

const SESSION_TTL_MS = 15 * 60_000
/** Hard ceiling regardless of activity — the board's own session is 90 days. */
const SESSION_MAX_MS = 8 * 60 * 60_000
/** Only extend when close to expiry, so a 10s poll isn't a write per tick. */
const SLIDE_WHEN_UNDER_MS = 10 * 60_000

/** Escalating, and persisted — an in-memory counter resets on every deploy. */
const LOCKOUT_STEPS: { after: number, ms: number }[] = [
  { after: 15, ms: 24 * 60 * 60_000 },
  { after: 10, ms: 60 * 60_000 },
  { after: 5, ms: 5 * 60_000 },
]

export interface FinanceClaim {
  profileId: string
  nonce: string
}

export interface FinanceAccess {
  profile: typeof profiles.$inferSelect
  member: typeof financeMembers.$inferSelect
  session: typeof financeSessions.$inferSelect
}

function nonceHash(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex')
}

/** Constant-time compare of two hex digests of equal length. */
function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * A throwaway argon2 verify so "does this profile have finance access" isn't
 * answerable from response timing. Two lines, and it costs nothing that
 * matters on a path that is already rate-limited.
 */
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$mGSTUmk6bMYQ0hCbJhIWCDkNiVcTlwzaWyPuGRDsMuo'
async function burnTime(pin: string) {
  try {
    await verify(DUMMY_HASH, pin)
  }
  catch { /* expected — the point is the elapsed time, not the result */ }
}

export function financeMemberFor(profileId: string) {
  return useDb().select().from(financeMembers).where(eq(financeMembers.profileId, profileId)).get() ?? null
}

/** Has anyone in the household enrolled? Drives trust-on-first-use. */
export function financeIsConfigured(): boolean {
  return !!useDb().select({ profileId: financeMembers.profileId }).from(financeMembers).limit(1).get()
}

export function financeOwnerName(): string | null {
  const row = useDb()
    .select({ name: profiles.name })
    .from(financeMembers)
    .innerJoin(profiles, eq(profiles.id, financeMembers.profileId))
    .where(eq(financeMembers.role, 'owner'))
    .limit(1)
    .get()
  return row?.name ?? null
}

/**
 * Set on the boot where BETTS_RESET_FINANCE_PIN cleared the PINs, so the UI can
 * say "a reset was armed" instead of silently presenting first-run setup.
 */
let resetArmed = false
export function markFinanceResetArmed() {
  resetArmed = true
}
export function financeResetArmed(): boolean {
  return resetArmed && !financeIsConfigured()
}

// ── Reading the claim ─────────────────────────────────────────────────────

function readClaim(session: unknown): FinanceClaim | null {
  const claim = (session as { finance?: unknown } | null | undefined)?.finance
  if (!claim || typeof claim !== 'object') return null
  const { profileId, nonce } = claim as Record<string, unknown>
  if (typeof profileId !== 'string' || typeof nonce !== 'string') return null
  return { profileId, nonce }
}

/**
 * Resolves finance access, or null. Never throws for "not allowed" — callers
 * choose between a 403 and a lock screen.
 */
export async function getFinanceAccess(event: H3Event): Promise<FinanceAccess | null> {
  // An API key is a long-lived bearer token that lives in Home Assistant YAML
  // and shell scripts, has no PIN, and is minted by "admin" — which is not a
  // boundary. It can never reach finance, valid claim or not.
  if (event.context.boardApiSession) return null

  let profile: typeof profiles.$inferSelect
  try {
    ({ profile } = await requireProfile(event))
  }
  catch {
    // No acting profile: an unlock-only session, or any /tv/* render.
    return null
  }

  const member = financeMemberFor(profile.id)
  if (!member) return null

  const claim = readClaim(await getUserSession(event))
  // The profile check is what kills the switch-and-inherit path, before the
  // nonce is even looked up: Dad's claim is worthless while acting as a kid.
  if (!claim || claim.profileId !== profile.id) return null

  const row = useDb().select().from(financeSessions)
    .where(eq(financeSessions.nonceHash, nonceHash(claim.nonce)))
    .get()
  if (!row || row.profileId !== profile.id) return null
  if (!digestsMatch(row.nonceHash, nonceHash(claim.nonce))) return null

  const now = Date.now()
  if (row.expiresAt.getTime() <= now || now - row.startedAt.getTime() > SESSION_MAX_MS) {
    useDb().delete(financeSessions).where(eq(financeSessions.id, row.id)).run()
    return null
  }

  // Sliding, but only written when it's close — otherwise every poll is a write.
  let current = row
  if (row.expiresAt.getTime() - now < SLIDE_WHEN_UNDER_MS) {
    const expiresAt = new Date(Math.min(now + SESSION_TTL_MS, row.startedAt.getTime() + SESSION_MAX_MS))
    current = useDb().update(financeSessions)
      .set({ expiresAt, lastSeenAt: new Date(now) })
      .where(eq(financeSessions.id, row.id))
      .returning()
      .get()
  }

  return { profile, member, session: current }
}

export async function requireFinanceAccess(event: H3Event): Promise<FinanceAccess> {
  // The finance middleware resolves this once per request; reading it here
  // means a route added outside /api/finance/ still gets a real check.
  const cached = event.context.financeAccess as FinanceAccess | undefined
  const access = cached ?? await getFinanceAccess(event)
  if (!access) throw createError({ statusCode: 403, statusMessage: 'Finance locked' })
  return access
}

/** Connect/disconnect banks, manage members, delete data. */
export async function requireFinanceOwner(event: H3Event): Promise<FinanceAccess> {
  const access = await requireFinanceAccess(event)
  if (access.member.role !== 'owner') {
    throw createError({ statusCode: 403, statusMessage: 'Finance owner only' })
  }
  return access
}

// ── Unlocking ─────────────────────────────────────────────────────────────

function lockoutFor(failedAttempts: number): number | null {
  const step = LOCKOUT_STEPS.find(s => failedAttempts >= s.after)
  return step ? step.ms : null
}

export async function unlockFinance(
  event: H3Event,
  args: { pin: string, deviceLabel?: string },
): Promise<{ expiresAt: number }> {
  const { profile } = await requireProfile(event)
  const member = financeMemberFor(profile.id)

  if (!member || !profile.pinHash) {
    await burnTime(args.pin)
    throw createError({ statusCode: 403, statusMessage: 'No finance access for this profile' })
  }

  const now = Date.now()
  if (member.lockedUntil && member.lockedUntil.getTime() > now) {
    const minutes = Math.ceil((member.lockedUntil.getTime() - now) / 60_000)
    throw createError({ statusCode: 429, statusMessage: `Too many attempts — locked for ${minutes} more minute(s)` })
  }

  if (!(await verify(profile.pinHash, args.pin))) {
    const failedAttempts = member.failedAttempts + 1
    const lockMs = lockoutFor(failedAttempts)
    useDb().update(financeMembers).set({
      failedAttempts,
      failedSinceLastUnlock: member.failedSinceLastUnlock + 1,
      lockedUntil: lockMs ? new Date(now + lockMs) : member.lockedUntil,
    }).where(eq(financeMembers.profileId, profile.id)).run()
    throw createError({ statusCode: 401, statusMessage: 'Wrong PIN' })
  }

  // A 256-bit random value: sha256 is the right hash here, same as API keys.
  const nonce = randomBytes(32).toString('hex')
  const expiresAt = new Date(now + SESSION_TTL_MS)
  useDb().insert(financeSessions).values({
    profileId: profile.id,
    nonceHash: nonceHash(nonce),
    startedAt: new Date(now),
    expiresAt,
    lastSeenAt: new Date(now),
    deviceLabel: args.deviceLabel ?? null,
  }).run()

  useDb().update(financeMembers).set({
    failedAttempts: 0,
    failedSinceLastUnlock: 0,
    lockedUntil: null,
    lastUnlockAt: new Date(now),
  }).where(eq(financeMembers.profileId, profile.id)).run()

  await setUserSession(event, { finance: { profileId: profile.id, nonce } })
  return { expiresAt: expiresAt.getTime() }
}

/**
 * Deleting the row is the lock — the cookie claim is inert without it. The
 * cookie write is tidiness only, and uses `false` rather than `null` because
 * defu treats a null source as "nothing to say" and would keep the old value.
 */
export async function lockFinance(event: H3Event): Promise<void> {
  const claim = readClaim(await getUserSession(event))
  if (claim) {
    useDb().delete(financeSessions)
      .where(eq(financeSessions.nonceHash, nonceHash(claim.nonce)))
      .run()
  }
  await setUserSession(event, { finance: false })
}

/** Every device, e.g. after a PIN change or when revoking a member. */
export function revokeFinanceSessions(profileId: string): void {
  useDb().delete(financeSessions).where(eq(financeSessions.profileId, profileId)).run()
}

/** Housekeeping so the table doesn't grow forever on a long-lived box. */
export function pruneExpiredFinanceSessions(): void {
  useDb().delete(financeSessions).where(lt(financeSessions.expiresAt, new Date())).run()
}

// ── Enrolment ─────────────────────────────────────────────────────────────

const ARGON_OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 }

/**
 * Set or change the acting profile's finance PIN.
 *
 * Bootstrapping is trust-on-first-use: the FIRST profile to enrol becomes the
 * owner, because at that moment there is no stronger anchor than the household
 * password, and requiring it would add ceremony without security (everyone
 * knows it). The mitigation is loudness, not secrecy — the finance card in
 * Settings shows "Finance is set up. Owner: <name>" to everyone, locked or
 * not, so a hijack is immediately visible rather than silent.
 *
 * After that, enrolling somebody else requires an owner with a live finance
 * session (see the members route); this call only ever changes your own.
 */
export async function setOwnFinancePin(
  event: H3Event,
  args: { pin: string, currentPin?: string },
): Promise<{ role: 'owner' | 'member' }> {
  const { profile } = await requireProfile(event)
  const household = requireHousehold()
  const existing = financeMemberFor(profile.id)

  if (existing && profile.pinHash) {
    // Changing an existing PIN needs the current one — being at the tablet
    // isn't enough, or the PIN would protect nothing.
    if (!args.currentPin || !(await verify(profile.pinHash, args.currentPin))) {
      await burnTime(args.pin)
      throw createError({ statusCode: 401, statusMessage: 'Wrong current PIN' })
    }
  }
  else if (existing) {
    // Enrolled but no hash: a BETTS_RESET_FINANCE_PIN boot. Re-set freely.
  }
  else if (financeIsConfigured()) {
    // Somebody else already owns finance; they have to add you.
    throw createError({ statusCode: 403, statusMessage: 'Ask a finance owner to give you access' })
  }

  const pinHash = await hash(args.pin, ARGON_OPTS)
  useDb().update(profiles).set({ pinHash }).where(eq(profiles.id, profile.id)).run()

  const role = existing?.role ?? (financeIsConfigured() ? 'member' : 'owner')
  if (existing) {
    useDb().update(financeMembers)
      .set({ failedAttempts: 0, failedSinceLastUnlock: 0, lockedUntil: null })
      .where(eq(financeMembers.profileId, profile.id))
      .run()
  }
  else {
    useDb().insert(financeMembers).values({
      profileId: profile.id,
      householdId: household.id,
      role,
    }).run()
  }

  // Changing the PIN invalidates every existing session, including this one.
  revokeFinanceSessions(profile.id)
  await setUserSession(event, { finance: false })
  return { role }
}

/** Owner action: enrol another profile with a PIN the owner types for them. */
export async function addFinanceMember(
  args: { profileId: string, pin: string, role: 'owner' | 'member' },
): Promise<void> {
  const household = requireHousehold()
  const target = useDb().select().from(profiles).where(eq(profiles.id, args.profileId)).get()
  if (!target || target.archivedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Profile not found' })
  }
  if (financeMemberFor(args.profileId)) {
    throw createError({ statusCode: 409, statusMessage: 'Already has finance access' })
  }

  const pinHash = await hash(args.pin, ARGON_OPTS)
  useDb().update(profiles).set({ pinHash }).where(eq(profiles.id, args.profileId)).run()
  useDb().insert(financeMembers).values({
    profileId: args.profileId,
    householdId: household.id,
    role: args.role,
  }).run()
}

export function removeFinanceMember(actingProfileId: string, profileId: string): void {
  if (actingProfileId === profileId) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot remove your own finance access' })
  }
  const member = financeMemberFor(profileId)
  if (!member) throw createError({ statusCode: 404, statusMessage: 'Not a finance member' })

  const owners = useDb().select({ profileId: financeMembers.profileId })
    .from(financeMembers).where(eq(financeMembers.role, 'owner')).all()
  if (member.role === 'owner' && owners.length <= 1) {
    throw createError({ statusCode: 409, statusMessage: 'Cannot remove the last finance owner' })
  }

  revokeFinanceSessions(profileId)
  useDb().update(profiles).set({ pinHash: null }).where(eq(profiles.id, profileId)).run()
  useDb().delete(financeMembers).where(eq(financeMembers.profileId, profileId)).run()
}

export function setFinanceMemberRole(actingProfileId: string, profileId: string, role: 'owner' | 'member'): void {
  const member = financeMemberFor(profileId)
  if (!member) throw createError({ statusCode: 404, statusMessage: 'Not a finance member' })

  if (member.role === 'owner' && role === 'member') {
    const owners = useDb().select({ profileId: financeMembers.profileId })
      .from(financeMembers).where(eq(financeMembers.role, 'owner')).all()
    if (owners.length <= 1) {
      throw createError({ statusCode: 409, statusMessage: 'Cannot demote the last finance owner' })
    }
    if (actingProfileId === profileId) {
      throw createError({ statusCode: 400, statusMessage: 'Cannot demote yourself' })
    }
  }
  useDb().update(financeMembers).set({ role }).where(eq(financeMembers.profileId, profileId)).run()
}

// ── State for the client ──────────────────────────────────────────────────

export async function financeSessionState(event: H3Event): Promise<FinanceSessionState> {
  const configured = financeIsConfigured()
  const base: FinanceSessionState = {
    enrolled: false,
    unlocked: false,
    role: null,
    expiresAt: null,
    ownerName: configured ? financeOwnerName() : null,
    configured,
    failedSinceLastUnlock: 0,
    lockedUntil: null,
    resetArmed: financeResetArmed(),
  }

  if (event.context.boardApiSession) return base

  let profile: typeof profiles.$inferSelect
  try {
    ({ profile } = await requireProfile(event))
  }
  catch {
    return base
  }

  const member = financeMemberFor(profile.id)
  if (!member) return base

  const access = await getFinanceAccess(event)
  return {
    ...base,
    enrolled: true,
    unlocked: !!access,
    role: member.role,
    expiresAt: access?.session.expiresAt.getTime() ?? null,
    failedSinceLastUnlock: member.failedSinceLastUnlock,
    lockedUntil: member.lockedUntil?.getTime() ?? null,
  }
}

/** Exported for the finance middleware and for tests. */
export const FINANCE_SESSION_TTL_MS = SESSION_TTL_MS
export const FINANCE_SESSION_MAX_MS = SESSION_MAX_MS
