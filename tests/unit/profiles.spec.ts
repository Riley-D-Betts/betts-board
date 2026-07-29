import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import { defaultHouseholdSettings, households, profiles } from '../../server/db/schema'
import { archiveProfile, isAdminProfile, updateProfile } from '../../server/services/profiles/store'

/**
 * The household must never be left with zero admins: demoting or archiving the
 * last admin locks every requireAdmin route out for good. Stepping down while
 * another admin exists is fine — the guard only blocks the last one.
 */

let db: Db
let householdId: string

beforeAll(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
})

beforeEach(() => {
  db.delete(profiles).run()
  db.delete(households).run()
  householdId = db.insert(households).values({
    name: 'Betts', passwordHash: 'x', timezone: 'America/Boise',
    icsToken: 'tok', settings: defaultHouseholdSettings,
  }).returning().get().id
})

function profile(name: string, role: 'admin' | 'adult' | 'kid') {
  return db.insert(profiles).values({ householdId, name, color: '#112233', role })
    .returning().get().id
}

describe('demoting an admin', () => {
  it('refuses to demote the only admin', () => {
    const admin = profile('Riley', 'admin')
    expect(() => updateProfile(db, admin, { role: 'adult' })).toThrow(/at least one admin/)
    expect(isAdminProfile(db, admin)).toBe(true)
  })

  it('allows demoting one admin when another remains', () => {
    const a = profile('Riley', 'admin')
    const b = profile('Sam', 'admin')
    expect(() => updateProfile(db, a, { role: 'adult' })).not.toThrow()
    expect(isAdminProfile(db, a)).toBe(false)
    expect(isAdminProfile(db, b)).toBe(true)
  })

  it('promoting an adult to admin always works', () => {
    profile('Riley', 'admin')
    const adult = profile('Sam', 'adult')
    expect(() => updateProfile(db, adult, { role: 'admin' })).not.toThrow()
    expect(isAdminProfile(db, adult)).toBe(true)
  })

  it('does not fire on a patch that leaves the role alone', () => {
    const admin = profile('Riley', 'admin')
    expect(() => updateProfile(db, admin, { name: 'Riley B.' })).not.toThrow()
    expect(isAdminProfile(db, admin)).toBe(true)
  })
})

describe('archiving an admin', () => {
  it('refuses to archive the only admin via the DELETE path', () => {
    const admin = profile('Riley', 'admin')
    expect(() => archiveProfile(db, admin)).toThrow(/at least one admin/)
    expect(isAdminProfile(db, admin)).toBe(true)
  })

  it('refuses to archive the only admin via a patch', () => {
    const admin = profile('Riley', 'admin')
    expect(() => updateProfile(db, admin, { archived: true })).toThrow(/at least one admin/)
    expect(isAdminProfile(db, admin)).toBe(true)
  })

  it('allows archiving one admin when another remains', () => {
    const a = profile('Riley', 'admin')
    profile('Sam', 'admin')
    expect(() => archiveProfile(db, a)).not.toThrow()
    expect(isAdminProfile(db, a)).toBe(false)
  })

  it('archiving a non-admin is unaffected', () => {
    profile('Riley', 'admin')
    const kid = profile('Max', 'kid')
    expect(() => archiveProfile(db, kid)).not.toThrow()
  })
})
