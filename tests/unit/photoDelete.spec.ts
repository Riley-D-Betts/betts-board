import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { H3Event } from 'h3'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import { defaultHouseholdSettings, households, photos, profiles } from '../../server/db/schema'
import { canDeletePhoto, requireDeletablePhoto } from '../../server/services/photos/access'
import { installNitroGlobals, makeEvent } from '../support/nitroGlobals'

/**
 * Deleting a photo is irreversible — the row and both files. Every profile is
 * one credential-free tap away, so "any unlocked profile" was never the right
 * rule: a bored kid could take the family album apart one photo at a time.
 */

// deletePhoto reaches for the uploads volume; keep that out of the repo tree.
const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'betts-photo-delete-'))
process.env.BETTS_DATA_DIR = TEST_DATA_DIR
afterAll(() => rmSync(TEST_DATA_DIR, { recursive: true, force: true }))

installNitroGlobals()
let routeParam = ''
const g = globalThis as Record<string, unknown>
g.defineEventHandler = (handler: unknown) => handler
g.getRouterParam = () => routeParam

const deleteRoute = (await import('../../server/api/photos/[id].delete')).default as unknown as
  (event: H3Event) => Promise<{ ok: boolean }>

let db: Db
let householdId: string
let dad: { id: string, role: 'admin' }
let mum: { id: string, role: 'adult' }
let kid: { id: string, role: 'kid' }
let sibling: { id: string, role: 'kid' }

function addPhoto(uploadedByProfileId: string | null, id?: string) {
  return db.insert(photos).values({
    householdId,
    uploadedByProfileId,
    path: `photos/${id ?? 'a'}.jpg`,
    thumbPath: `photos/thumbs/${id ?? 'a'}.jpg`,
    width: 10,
    height: 10,
    sizeBytes: 100,
    inSlideshow: true,
  }).returning().get()
}

beforeEach(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db) // the route resolves its own db through useDb()
  householdId = db.insert(households).values({
    name: 'Betts', passwordHash: 'x', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get().id

  const insert = (name: string, role: 'admin' | 'adult' | 'kid') =>
    db.insert(profiles).values({ householdId, name, color: '#112233', role }).returning().get().id
  dad = { id: insert('Dad', 'admin'), role: 'admin' }
  mum = { id: insert('Mum', 'adult'), role: 'adult' }
  kid = { id: insert('Kid', 'kid'), role: 'kid' }
  sibling = { id: insert('Sib', 'kid'), role: 'kid' }
})

describe('who may delete a photo', () => {
  it('refuses a kid deleting the family’s photos', () => {
    const mums = addPhoto(mum.id)
    expect(canDeletePhoto(mums, kid)).toBe(false)
    expect(() => requireDeletablePhoto(db, householdId, mums.id, kid))
      .toThrow(expect.objectContaining({ statusCode: 403 }))
    // Still there — the guard runs before anything is removed.
    expect(db.select().from(photos).all()).toHaveLength(1)
  })

  it('refuses one kid deleting another kid’s upload', () => {
    const theirs = addPhoto(sibling.id)
    expect(canDeletePhoto(theirs, kid)).toBe(false)
  })

  it('refuses a kid deleting a photo with no uploader (API key, or pre-profiles)', () => {
    const orphan = addPhoto(null)
    expect(canDeletePhoto(orphan, kid)).toBe(false)
  })

  it('lets a kid take back what they uploaded themselves', () => {
    const own = addPhoto(kid.id)
    expect(canDeletePhoto(own, kid)).toBe(true)
    expect(requireDeletablePhoto(db, householdId, own.id, kid).id).toBe(own.id)
  })

  it('lets any adult or admin curate the album, whoever uploaded it', () => {
    const kids = addPhoto(kid.id)
    expect(canDeletePhoto(kids, mum)).toBe(true)
    expect(canDeletePhoto(kids, dad)).toBe(true)
    expect(requireDeletablePhoto(db, householdId, kids.id, mum).id).toBe(kids.id)
  })

  it('404s an unknown photo, and one from another household, before any role check', () => {
    expect(() => requireDeletablePhoto(db, householdId, 'nope', dad))
      .toThrow(expect.objectContaining({ statusCode: 404 }))

    const other = db.insert(households).values({
      name: 'Next door', passwordHash: 'x', timezone: 'America/Boise',
      icsToken: 'tok2', settings: defaultHouseholdSettings,
    }).returning().get().id
    const theirs = addPhoto(null, 'b')
    expect(() => requireDeletablePhoto(db, other, theirs.id, dad))
      .toThrow(expect.objectContaining({ statusCode: 404 }))
  })
})

/**
 * The service above can be flawless and never be consulted: the whole fix is
 * one line in the route, and deleting that line is invisible to lint, to the
 * typechecker, and to every test that calls the service directly. So the route
 * itself is driven here — the same reason POST /api/auth/profile is.
 */
describe('DELETE /api/photos/:id', () => {
  const actAs = (who: { id: string, role: 'admin' | 'adult' | 'kid' }) =>
    makeEvent({ user: { unlocked: true, householdId, profileId: who.id, role: who.role } })

  it('refuses a kid deleting someone else’s photo, and removes nothing', async () => {
    const mums = addPhoto(mum.id)
    routeParam = mums.id
    await expect(deleteRoute(actAs(kid))).rejects.toMatchObject({ statusCode: 403 })
    expect(db.select().from(photos).all()).toHaveLength(1)
  })

  it('still lets an adult curate the album', async () => {
    const kids = addPhoto(kid.id)
    routeParam = kids.id
    await expect(deleteRoute(actAs(mum))).resolves.toMatchObject({ ok: true })
    expect(db.select().from(photos).all()).toHaveLength(0)
  })

  it('still lets a kid take back their own upload', async () => {
    const own = addPhoto(kid.id)
    routeParam = own.id
    await expect(deleteRoute(actAs(kid))).resolves.toMatchObject({ ok: true })
    expect(db.select().from(photos).all()).toHaveLength(0)
  })
})
