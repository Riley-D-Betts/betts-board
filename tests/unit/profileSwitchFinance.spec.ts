import { hash } from '@node-rs/argon2'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import {
  defaultHouseholdSettings, financeMembers, financeSessions, households, profiles,
} from '../../server/db/schema'
import { installNitroGlobals, makeEvent, sessionOf } from '../support/nitroGlobals'

/**
 * The hand-over attack: Dad unlocks Money with his PIN and puts the tablet
 * down. A kid taps their own face (switching profiles needs no credential),
 * then taps Dad's face back. Before the fix the finance_sessions row survived
 * both switches, so the kid was inside Money without ever meeting the PIN.
 *
 * Exercised through the real route handler, because the fix lives in it — a
 * test of the service alone would still pass with the route reverted.
 */

installNitroGlobals()

const g = globalThis as Record<string, unknown>
g.defineEventHandler = (handler: unknown) => handler
g.getRouterParam = () => undefined
g.readValidatedBody = async (
  event: { body?: unknown },
  parse: (v: unknown) => unknown,
) => parse(event.body)

const switchProfile = (await import('../../server/api/auth/profile.post')).default as unknown as
  (event: H3Event) => Promise<{ ok: boolean, profileId: string }>
const { getFinanceAccess, unlockFinance } = await import('../../server/services/finance/access')

let db: Db
let householdId: string
let dad: string
let kid: string

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

  householdId = db.insert(households).values({
    name: 'Betts', passwordHash: 'x', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get().id

  const insert = (name: string, role: 'admin' | 'adult' | 'kid') =>
    db.insert(profiles).values({ householdId, name, color: '#112233', role }).returning().get().id
  dad = insert('Dad', 'admin')
  kid = insert('Kid', 'kid')

  await db.update(profiles).set({ pinHash: await hash('dadpin', ARGON) }).where(eq(profiles.id, dad)).run()
  db.insert(financeMembers).values({ profileId: dad, householdId, role: 'owner' }).run()
})

/** One device: the session cookie and the POST body both live on the event. */
function device(profileId: string, role: 'admin' | 'adult' | 'kid' = 'admin') {
  return makeEvent({ user: { unlocked: true, householdId, profileId, role } }) as H3Event & { body?: unknown }
}

async function switchTo(event: H3Event & { body?: unknown }, profileId: string) {
  event.body = { profileId }
  return switchProfile(event)
}

describe('POST /api/auth/profile and the Money session', () => {
  it('ends the Money session, so switching away and back does not inherit it', async () => {
    const tablet = device(dad)
    await unlockFinance(tablet, { pin: 'dadpin' })
    expect(await getFinanceAccess(tablet)).not.toBeNull()

    await switchTo(tablet, kid)
    // Not merely hidden behind the profile binding: the row itself is gone.
    expect(db.select().from(financeSessions).all()).toHaveLength(0)

    // The kid taps Dad's face back — no credential required anywhere here.
    await switchTo(tablet, dad)
    expect(await getFinanceAccess(tablet)).toBeNull()
  })

  it('leaves the Money session alone when the acting profile does not change', async () => {
    // Tapping your own face in the profile switcher is a no-op, and must not
    // cost you the unlock you just typed a PIN for.
    const tablet = device(dad)
    await unlockFinance(tablet, { pin: 'dadpin' })

    await switchTo(tablet, dad)
    expect(await getFinanceAccess(tablet)).not.toBeNull()
    expect(db.select().from(financeSessions).all()).toHaveLength(1)
  })

  it('revokes only the device that switched', async () => {
    const tablet = device(dad)
    const phone = device(dad)
    await unlockFinance(tablet, { pin: 'dadpin' })
    await unlockFinance(phone, { pin: 'dadpin' })

    await switchTo(tablet, kid)
    expect(await getFinanceAccess(phone)).not.toBeNull()
    expect(sessionOf(phone).finance).toBeTruthy()
  })

  it('still switches profiles, and still 404s an unknown one', async () => {
    const tablet = device(dad)
    await expect(switchTo(tablet, kid)).resolves.toMatchObject({ ok: true, profileId: kid })
    expect((sessionOf(tablet).user as { profileId: string }).profileId).toBe(kid)

    await expect(switchTo(tablet, '00000000-0000-0000-0000-000000000000'))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})
