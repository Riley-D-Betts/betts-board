import { hash } from '@node-rs/argon2'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings, financeMembers, financeSessions, households, profiles,
} from '../../server/db/schema'
import { installNitroGlobals, makeEvent, sessionOf } from '../support/nitroGlobals'

installNitroGlobals()

const {
  addFinanceMember, financeSessionState, getFinanceAccess, lockFinance, removeFinanceMember,
  requireFinanceAccess, requireFinanceOwner, setFinanceMemberRole, setOwnFinancePin, unlockFinance,
} = await import('../../server/services/finance/access')

let db: Db
let householdId: string
let dad: string
let kid: string
let mum: string

const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 }

beforeAll(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
})

beforeEach(async () => {
  db.delete(financeSessions).run()
  db.delete(financeMembers).run()
  db.delete(profiles).run()
  db.delete(households).run()

  const hh = db.insert(households).values({
    name: 'Betts', passwordHash: 'x', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get()
  householdId = hh.id

  const insert = (name: string, role: 'admin' | 'adult' | 'kid') =>
    db.insert(profiles).values({ householdId, name, color: '#112233', role }).returning().get().id
  dad = insert('Dad', 'admin')
  mum = insert('Mum', 'adult')
  kid = insert('Kid', 'kid')
})

/** A session in the shape the real app writes: everything under `user`. */
function sessionFor(profileId: string, role: 'admin' | 'adult' | 'kid' = 'admin') {
  return makeEvent({ user: { unlocked: true, householdId, profileId, role } })
}

async function enrol(profileId: string, pin: string, role: 'owner' | 'member' = 'owner') {
  await db.update(profiles).set({ pinHash: await hash(pin, ARGON) }).where(eq(profiles.id, profileId)).run()
  db.insert(financeMembers).values({ profileId, householdId, role }).run()
}

describe('unlocking', () => {
  it('rejects a wrong PIN and counts the attempt', async () => {
    await enrol(dad, 'letmein')
    const event = sessionFor(dad)

    await expect(unlockFinance(event, { pin: 'nottheone' })).rejects.toMatchObject({ statusCode: 401 })
    const member = db.select().from(financeMembers).where(eq(financeMembers.profileId, dad)).get()
    expect(member!.failedAttempts).toBe(1)
    expect(member!.failedSinceLastUnlock).toBe(1)
    expect(await getFinanceAccess(event)).toBeNull()
  })

  it('accepts the right PIN, mints a session, and resets the counters', async () => {
    await enrol(dad, 'letmein')
    const event = sessionFor(dad)
    db.update(financeMembers).set({ failedAttempts: 3, failedSinceLastUnlock: 3 })
      .where(eq(financeMembers.profileId, dad)).run()

    const { expiresAt } = await unlockFinance(event, { pin: 'letmein', deviceLabel: 'Kitchen tablet' })
    expect(expiresAt).toBeGreaterThan(Date.now())

    const access = await getFinanceAccess(event)
    expect(access?.profile.id).toBe(dad)
    expect(access?.member.role).toBe('owner')

    const member = db.select().from(financeMembers).where(eq(financeMembers.profileId, dad)).get()
    expect(member!.failedAttempts).toBe(0)
    expect(member!.failedSinceLastUnlock).toBe(0)
    expect(member!.lastUnlockAt).not.toBeNull()
  })

  it('stores only a hash of the nonce, never the nonce itself', async () => {
    await enrol(dad, 'letmein')
    const event = sessionFor(dad)
    await unlockFinance(event, { pin: 'letmein' })

    const claim = sessionOf(event).finance as { nonce: string }
    const row = db.select().from(financeSessions).get()
    expect(row!.nonceHash).not.toBe(claim.nonce)
    expect(row!.nonceHash).toHaveLength(64)
  })

  it('locks out after 5 failures, escalating with more', async () => {
    await enrol(dad, 'letmein')
    const event = sessionFor(dad)

    for (let i = 0; i < 5; i++) {
      await expect(unlockFinance(event, { pin: 'wrong' })).rejects.toMatchObject({ statusCode: 401 })
    }
    // The 6th is refused before argon2 even runs.
    await expect(unlockFinance(event, { pin: 'letmein' })).rejects.toMatchObject({ statusCode: 429 })

    const after5 = db.select().from(financeMembers).where(eq(financeMembers.profileId, dad)).get()!
    const firstStep = after5.lockedUntil!.getTime()

    // Clear the lock and push the counter to the next step.
    db.update(financeMembers).set({ lockedUntil: null, failedAttempts: 9 })
      .where(eq(financeMembers.profileId, dad)).run()
    await expect(unlockFinance(event, { pin: 'wrong' })).rejects.toMatchObject({ statusCode: 401 })
    const after10 = db.select().from(financeMembers).where(eq(financeMembers.profileId, dad)).get()!
    expect(after10.lockedUntil!.getTime() - Date.now()).toBeGreaterThan(firstStep - Date.now())
  })

  it('survives a restart, because the lockout is a column and not a Map', async () => {
    await enrol(dad, 'letmein')
    db.update(financeMembers).set({ lockedUntil: new Date(Date.now() + 60_000), failedAttempts: 5 })
      .where(eq(financeMembers.profileId, dad)).run()
    // Nothing in-memory to reset — a fresh event is a fresh process, in effect.
    await expect(unlockFinance(sessionFor(dad), { pin: 'letmein' })).rejects.toMatchObject({ statusCode: 429 })
  })

  it('refuses a profile with no finance membership', async () => {
    const event = sessionFor(kid, 'kid')
    await expect(unlockFinance(event, { pin: 'whatever' })).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('the switch-and-inherit attack', () => {
  it('does not let a kid inherit a claim by switching profiles', async () => {
    await enrol(dad, 'letmein')
    const event = sessionFor(dad)
    await unlockFinance(event, { pin: 'letmein' })
    expect(await getFinanceAccess(event)).not.toBeNull()

    // Exactly what POST /api/auth/profile does: writes `user`, merged by defu.
    await (globalThis as { setUserSession?: (e: unknown, d: unknown) => Promise<unknown> })
      .setUserSession!(event, { user: { unlocked: true, householdId, profileId: kid, role: 'kid' } })

    // The claim IS still in the cookie — defu preserved it. That is the whole
    // reason authority lives in the database.
    expect(sessionOf(event).finance).toBeTruthy()
    expect(await getFinanceAccess(event)).toBeNull()
    await expect(requireFinanceAccess(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('does not let a finance member ride another member’s nonce', async () => {
    await enrol(dad, 'dadpin')
    await enrol(mum, 'mumpin', 'member')

    const dadEvent = sessionFor(dad)
    await unlockFinance(dadEvent, { pin: 'dadpin' })
    const stolen = sessionOf(dadEvent).finance

    // Mum is a legitimate finance member, so the membership check passes —
    // only the profileId binding on the claim stops her.
    const mumEvent = makeEvent({
      user: { unlocked: true, householdId, profileId: mum, role: 'adult' },
      finance: stolen,
    })
    expect(await getFinanceAccess(mumEvent)).toBeNull()
  })
})

describe('API keys and TV', () => {
  it('rejects a bearer API key even when it carries a valid claim', async () => {
    await enrol(dad, 'letmein')
    const event = sessionFor(dad)
    await unlockFinance(event, { pin: 'letmein' })
    const claim = sessionOf(event).finance

    // verifyBearerToken stashes a resolved session here; that is the only
    // signal, and it is checked before anything else.
    const keyEvent = makeEvent({ user: { unlocked: true, householdId, profileId: dad, role: 'admin' }, finance: claim })
    keyEvent.context.boardApiSession = { unlocked: true, householdId, profileId: dad, role: 'admin' }

    expect(await getFinanceAccess(keyEvent)).toBeNull()
    await expect(requireFinanceAccess(keyEvent)).rejects.toMatchObject({ statusCode: 403 })
    expect((await financeSessionState(keyEvent)).unlocked).toBe(false)
  })

  it('rejects a session with no acting profile — every /tv/* render', async () => {
    await enrol(dad, 'letmein')
    const event = makeEvent({ user: { unlocked: true, householdId } })
    expect(await getFinanceAccess(event)).toBeNull()
  })

  it('rejects a claim whose profile has been archived', async () => {
    await enrol(dad, 'letmein')
    const event = sessionFor(dad)
    await unlockFinance(event, { pin: 'letmein' })
    db.update(profiles).set({ archivedAt: new Date() }).where(eq(profiles.id, dad)).run()
    expect(await getFinanceAccess(event)).toBeNull()
  })
})

describe('expiry and revocation', () => {
  it('expires on the TTL and cleans up the row', async () => {
    await enrol(dad, 'letmein')
    const event = sessionFor(dad)
    await unlockFinance(event, { pin: 'letmein' })

    db.update(financeSessions).set({ expiresAt: new Date(Date.now() - 1) }).run()
    expect(await getFinanceAccess(event)).toBeNull()
    expect(db.select().from(financeSessions).all()).toHaveLength(0)
  })

  it('enforces the 8-hour ceiling even if the session keeps sliding', async () => {
    await enrol(dad, 'letmein')
    const event = sessionFor(dad)
    await unlockFinance(event, { pin: 'letmein' })

    db.update(financeSessions).set({
      startedAt: new Date(Date.now() - 9 * 60 * 60_000),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    }).run()
    expect(await getFinanceAccess(event)).toBeNull()
  })

  it('slides the expiry when it is close, and does not when it is not', async () => {
    await enrol(dad, 'letmein')
    const event = sessionFor(dad)
    await unlockFinance(event, { pin: 'letmein' })
    const initial = db.select().from(financeSessions).get()!.expiresAt.getTime()

    // Far from expiry: no write.
    await getFinanceAccess(event)
    expect(db.select().from(financeSessions).get()!.expiresAt.getTime()).toBe(initial)

    // Inside the slide window: extended.
    db.update(financeSessions).set({ expiresAt: new Date(Date.now() + 60_000) }).run()
    await getFinanceAccess(event)
    expect(db.select().from(financeSessions).get()!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 60_000)
  })

  it('locks by deleting the row, which takes effect immediately', async () => {
    await enrol(dad, 'letmein')
    const event = sessionFor(dad)
    await unlockFinance(event, { pin: 'letmein' })
    await lockFinance(event)

    expect(db.select().from(financeSessions).all()).toHaveLength(0)
    expect(await getFinanceAccess(event)).toBeNull()
  })

  it('is revoked by deleting the row even if the cookie is untouched', async () => {
    await enrol(dad, 'letmein')
    const event = sessionFor(dad)
    await unlockFinance(event, { pin: 'letmein' })

    db.delete(financeSessions).run() // e.g. another device pressed "revoke"
    expect(sessionOf(event).finance).toBeTruthy()
    expect(await getFinanceAccess(event)).toBeNull()
  })

  it('rejects a forged nonce', async () => {
    await enrol(dad, 'letmein')
    const event = sessionFor(dad)
    await unlockFinance(event, { pin: 'letmein' })
    ;(sessionOf(event).finance as { nonce: string }).nonce = 'f'.repeat(64)
    expect(await getFinanceAccess(event)).toBeNull()
  })

  it.each([
    ['missing', undefined],
    ['not an object', 'nope'],
    ['half a claim', { profileId: 'x' }],
    ['non-string nonce', { profileId: 'x', nonce: 42 }],
  ])('ignores a %s claim', async (_label, finance) => {
    await enrol(dad, 'letmein')
    const event = makeEvent({ user: { unlocked: true, householdId, profileId: dad, role: 'admin' }, finance })
    expect(await getFinanceAccess(event)).toBeNull()
  })
})

describe('enrolment', () => {
  it('makes the first profile to set a PIN the owner', async () => {
    const event = sessionFor(dad)
    const { role } = await setOwnFinancePin(event, { pin: 'firstpin' })
    expect(role).toBe('owner')
    expect(db.select().from(financeMembers).where(eq(financeMembers.profileId, dad)).get()!.role).toBe('owner')
  })

  it('refuses a second profile self-enrolling once finance is configured', async () => {
    await setOwnFinancePin(sessionFor(dad), { pin: 'firstpin' })
    await expect(setOwnFinancePin(sessionFor(kid, 'kid'), { pin: 'kidpin' }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('requires the current PIN to change it', async () => {
    await enrol(dad, 'oldpin')
    const event = sessionFor(dad)
    await expect(setOwnFinancePin(event, { pin: 'newpin' })).rejects.toMatchObject({ statusCode: 401 })
    await expect(setOwnFinancePin(event, { pin: 'newpin', currentPin: 'guessed' }))
      .rejects.toMatchObject({ statusCode: 401 })

    await setOwnFinancePin(event, { pin: 'newpin', currentPin: 'oldpin' })
    await unlockFinance(event, { pin: 'newpin' })
    expect(await getFinanceAccess(event)).not.toBeNull()
  })

  it('revokes every session when the PIN changes', async () => {
    await enrol(dad, 'oldpin')
    const phone = sessionFor(dad)
    const tablet = sessionFor(dad)
    await unlockFinance(phone, { pin: 'oldpin' })
    await unlockFinance(tablet, { pin: 'oldpin' })
    expect(db.select().from(financeSessions).all()).toHaveLength(2)

    await setOwnFinancePin(phone, { pin: 'newpin', currentPin: 'oldpin' })
    expect(db.select().from(financeSessions).all()).toHaveLength(0)
    expect(await getFinanceAccess(tablet)).toBeNull()
  })

  it('lets an owner re-set a PIN with no current PIN after a reset boot', async () => {
    await enrol(dad, 'oldpin')
    // What BETTS_RESET_FINANCE_PIN does: clears the hash, keeps the membership.
    db.update(profiles).set({ pinHash: null }).where(eq(profiles.id, dad)).run()

    const event = sessionFor(dad)
    const { role } = await setOwnFinancePin(event, { pin: 'brandnew' })
    expect(role).toBe('owner')
    await unlockFinance(event, { pin: 'brandnew' })
    expect(await getFinanceAccess(event)).not.toBeNull()
  })
})

describe('membership management', () => {
  it('needs a live finance session, not household admin', async () => {
    await enrol(dad, 'letmein')
    // Dad IS a household admin and IS the finance owner — but locked.
    await expect(requireFinanceOwner(sessionFor(dad))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects a member trying to act as an owner', async () => {
    await enrol(mum, 'mumpin', 'member')
    const event = sessionFor(mum, 'adult')
    await unlockFinance(event, { pin: 'mumpin' })
    await expect(requireFinanceOwner(event)).rejects.toMatchObject({ statusCode: 403 })
    await expect(requireFinanceAccess(event)).resolves.toBeTruthy()
  })

  it('lets an owner enrol somebody else', async () => {
    await enrol(dad, 'letmein')
    await addFinanceMember({ profileId: mum, pin: 'mumpin', role: 'member' })

    const mumEvent = sessionFor(mum, 'adult')
    await unlockFinance(mumEvent, { pin: 'mumpin' })
    expect((await getFinanceAccess(mumEvent))?.member.role).toBe('member')
  })

  it('refuses to enrol the same profile twice', async () => {
    await enrol(dad, 'letmein')
    await expect(addFinanceMember({ profileId: dad, pin: 'other1', role: 'member' }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuses to remove the last owner, or yourself', async () => {
    await enrol(dad, 'letmein')
    expect(() => removeFinanceMember(dad, dad)).toThrow(expect.objectContaining({ statusCode: 400 }))

    await addFinanceMember({ profileId: mum, pin: 'mumpin', role: 'member' })
    expect(() => removeFinanceMember(mum, dad)).toThrow(expect.objectContaining({ statusCode: 409 }))
  })

  it('clears the PIN and every session when a member is removed', async () => {
    await enrol(dad, 'letmein')
    await addFinanceMember({ profileId: mum, pin: 'mumpin', role: 'member' })
    const mumEvent = sessionFor(mum, 'adult')
    await unlockFinance(mumEvent, { pin: 'mumpin' })

    removeFinanceMember(dad, mum)
    expect(db.select().from(profiles).where(eq(profiles.id, mum)).get()!.pinHash).toBeNull()
    expect(await getFinanceAccess(mumEvent)).toBeNull()
  })

  it('refuses to demote the last owner', async () => {
    await enrol(dad, 'letmein')
    await addFinanceMember({ profileId: mum, pin: 'mumpin', role: 'member' })
    expect(() => setFinanceMemberRole(mum, dad, 'member')).toThrow(expect.objectContaining({ statusCode: 409 }))

    setFinanceMemberRole(dad, mum, 'owner')
    expect(() => setFinanceMemberRole(mum, dad, 'member')).not.toThrow()
  })
})

describe('financeSessionState', () => {
  it('reports first-run state without leaking anything', async () => {
    const state = await financeSessionState(sessionFor(dad))
    expect(state).toMatchObject({ configured: false, enrolled: false, unlocked: false, ownerName: null })
  })

  it('names the owner to everyone, so a hijack is loud rather than silent', async () => {
    await enrol(dad, 'letmein')
    const state = await financeSessionState(sessionFor(kid, 'kid'))
    expect(state).toMatchObject({ configured: true, enrolled: false, unlocked: false, ownerName: 'Dad' })
  })

  it('surfaces failed attempts to the person who owns the PIN', async () => {
    await enrol(dad, 'letmein')
    const event = sessionFor(dad)
    await expect(unlockFinance(event, { pin: 'wrong' })).rejects.toThrow()
    await expect(unlockFinance(event, { pin: 'wrong' })).rejects.toThrow()

    expect((await financeSessionState(event)).failedSinceLastUnlock).toBe(2)
    await unlockFinance(event, { pin: 'letmein' })
    const after = await financeSessionState(event)
    expect(after.failedSinceLastUnlock).toBe(0)
    expect(after.unlocked).toBe(true)
    expect(after.expiresAt).toBeGreaterThan(Date.now())
  })
})
