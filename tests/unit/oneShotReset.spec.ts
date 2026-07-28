import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hash } from '@node-rs/argon2'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * The attack is an operator footgun with a security outcome: leave
 * BETTS_RESET_PASSWORD=1 in docker-compose.yml — which the old comment asked
 * people not to do, and nothing enforced — and every restart, crash-loop or
 * image update silently re-opens the board to whoever reaches it first. Same
 * shape for BETTS_RESET_FINANCE_PIN, where "first" then owns the bank data.
 *
 * So these tests boot the plugins repeatedly with the variable still set.
 */

// Must be set before dataDir() is first called: the marker lives in the volume.
const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'betts-reset-spec-'))
process.env.BETTS_DATA_DIR = TEST_DATA_DIR
afterAll(() => rmSync(TEST_DATA_DIR, { recursive: true, force: true }))

const g = globalThis as Record<string, unknown>
g.defineNitroPlugin = (fn: unknown) => fn

const { createDb, setDb } = await import('../../server/db/client')
const {
  defaultHouseholdSettings, financeMembers, financeSessions, households, profiles,
} = await import('../../server/db/schema')
const resetPassword = (await import('../../server/plugins/03.resetPassword')).default as unknown as () => void
const resetFinancePin = (await import('../../server/plugins/04.resetFinancePin')).default as unknown as () => void

type Db = ReturnType<typeof createDb>
let db: Db
let householdId: string
let dad: string

const PASSWORD_MARKER = join(TEST_DATA_DIR, '.betts-reset-password.done')
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 }

beforeEach(async () => {
  delete process.env.BETTS_RESET_PASSWORD
  delete process.env.BETTS_RESET_FINANCE_PIN
  rmSync(PASSWORD_MARKER, { force: true })
  rmSync(join(TEST_DATA_DIR, '.betts-reset-finance-pin.done'), { force: true })

  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
  householdId = db.insert(households).values({
    name: 'Betts', passwordHash: 'originalhash', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get().id
  dad = db.insert(profiles).values({
    householdId, name: 'Dad', color: '#112233', role: 'admin',
  }).returning().get().id
  await db.update(profiles).set({ pinHash: await hash('dadpin', ARGON) }).where(eq(profiles.id, dad)).run()
  db.insert(financeMembers).values({ profileId: dad, householdId, role: 'owner' }).run()
})

const passwordHash = () =>
  db.select().from(households).where(eq(households.id, householdId)).get()!.passwordHash
const pinHash = () =>
  db.select().from(profiles).where(eq(profiles.id, dad)).get()!.pinHash

/** Set the password again, as the family would at the unlock screen. */
function familySetsANewPassword() {
  db.update(households).set({ passwordHash: 'newhash' }).where(eq(households.id, householdId)).run()
}

describe('BETTS_RESET_PASSWORD', () => {
  it('clears the password once, then ignores the variable on every later boot', () => {
    process.env.BETTS_RESET_PASSWORD = '1'

    resetPassword()
    expect(passwordHash()).toBe('')

    familySetsANewPassword()
    // The variable is still in docker-compose.yml. Restart. Restart again.
    resetPassword()
    resetPassword()
    expect(passwordHash()).toBe('newhash')
  })

  it('records the arming in the data volume, so a container rebuild changes nothing', () => {
    process.env.BETTS_RESET_PASSWORD = '1'
    resetPassword()
    expect(existsSync(PASSWORD_MARKER)).toBe(true)

    familySetsANewPassword()
    // A new process with a fresh module registry is exactly what the marker is
    // for; nothing in memory could have survived it.
    resetPassword()
    expect(passwordHash()).toBe('newhash')
  })

  it('re-arms once the operator removes the variable', () => {
    process.env.BETTS_RESET_PASSWORD = '1'
    resetPassword()
    familySetsANewPassword()

    delete process.env.BETTS_RESET_PASSWORD
    resetPassword() // the boot that forgets the previous arming
    expect(passwordHash()).toBe('newhash')

    process.env.BETTS_RESET_PASSWORD = '1'
    resetPassword()
    expect(passwordHash()).toBe('')
  })

  it('re-arms on a different value, without needing a boot in between', () => {
    process.env.BETTS_RESET_PASSWORD = '1'
    resetPassword()
    familySetsANewPassword()

    process.env.BETTS_RESET_PASSWORD = 'again'
    resetPassword()
    expect(passwordHash()).toBe('')
  })

  it.each(['0', 'false', 'no', 'off', ''])('treats %o as off, not as an arming', (value) => {
    // The plugins used to demand exactly '1'. Accepting any value so that a
    // changed value re-arms must not make the obvious spellings of "disabled"
    // clear the household password on the next boot.
    process.env.BETTS_RESET_PASSWORD = value
    resetPassword()
    expect(passwordHash()).toBe('originalhash')
    expect(existsSync(PASSWORD_MARKER)).toBe(false)
  })

  it('does nothing at all when unset, and burns nothing before setup', () => {
    resetPassword()
    expect(passwordHash()).toBe('originalhash')
    expect(existsSync(PASSWORD_MARKER)).toBe(false)

    // Pre-setup boot with the variable set: no household, so no arming spent.
    db.delete(financeMembers).run()
    db.delete(profiles).run()
    db.delete(households).run()
    process.env.BETTS_RESET_PASSWORD = '1'
    resetPassword()
    expect(existsSync(PASSWORD_MARKER)).toBe(false)
  })
})

describe('BETTS_RESET_FINANCE_PIN', () => {
  it('clears every PIN once, then leaves the new one alone', async () => {
    process.env.BETTS_RESET_FINANCE_PIN = '1'
    db.insert(financeSessions).values({
      profileId: dad, nonceHash: 'f'.repeat(64),
      startedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), lastSeenAt: new Date(),
    }).run()

    resetFinancePin()
    expect(pinHash()).toBeNull()
    expect(db.select().from(financeSessions).all()).toHaveLength(0)
    // Membership survives — the reset costs the PIN, not the family's history.
    expect(db.select().from(financeMembers).all()).toHaveLength(1)

    // Dad sets a new PIN, then the box restarts with the variable still set.
    await db.update(profiles).set({ pinHash: await hash('brandnew', ARGON) }).where(eq(profiles.id, dad)).run()
    resetFinancePin()
    resetFinancePin()
    expect(pinHash()).not.toBeNull()
  })

  it('does not spend the arming when nobody has a PIN yet', () => {
    db.update(profiles).set({ pinHash: null }).where(eq(profiles.id, dad)).run()
    process.env.BETTS_RESET_FINANCE_PIN = '1'
    resetFinancePin()
    expect(existsSync(join(TEST_DATA_DIR, '.betts-reset-finance-pin.done'))).toBe(false)
  })
})
