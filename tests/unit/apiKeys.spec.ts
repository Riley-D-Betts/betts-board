import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { createDb, type Db } from '../../server/db/client'
import { apiKeys, defaultHouseholdSettings, households, profiles } from '../../server/db/schema'
import { createApiKey, listApiKeys, revokeApiKey, verifyBearerToken } from '../../server/services/apiKeys/keys'

let db: Db
let householdId: string
let mom: string
let kid: string

beforeEach(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  const hh = db.insert(households).values({
    name: 'Test',
    passwordHash: 'x',
    timezone: 'America/Boise',
    icsToken: 'tok',
    settings: defaultHouseholdSettings,
  }).returning().get()
  householdId = hh.id
  mom = db.insert(profiles).values({ householdId, name: 'Mom', color: '#ec4899', role: 'admin' }).returning().get().id
  kid = db.insert(profiles).values({ householdId, name: 'Kid', color: '#22c55e', role: 'kid' }).returning().get().id
})

function keyRow(id: string) {
  return db.select().from(apiKeys).where(eq(apiKeys.id, id)).get()!
}

describe('createApiKey', () => {
  it('returns a bb_ token once and stores only its hash', () => {
    const created = createApiKey(db, { householdId, name: 'Home Assistant' })
    expect(created.token).toMatch(/^bb_[0-9a-f]{48}$/)

    const row = keyRow(created.id)
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/) // sha-256 hex, not the token
    expect(row.tokenHash).not.toBe(created.token)
    // The raw token appears nowhere in the table.
    expect(JSON.stringify(db.select().from(apiKeys).all())).not.toContain(created.token)
  })

  it('resolves the bound profile name in the returned DTO', () => {
    const created = createApiKey(db, { householdId, name: 'Mom key', profileId: mom })
    expect(created.profileId).toBe(mom)
    expect(created.profileName).toBe('Mom')
    expect(created.revoked).toBe(false)
  })
})

describe('verifyBearerToken', () => {
  it('resolves an unbound token to a profile-less unlocked session', () => {
    const { token } = createApiKey(db, { householdId, name: 'Read only' })
    expect(verifyBearerToken(db, token)).toEqual({
      unlocked: true,
      householdId,
      profileId: undefined,
      role: undefined,
    })
  })

  it('resolves a bound token with the profile and its role', () => {
    const { token } = createApiKey(db, { householdId, name: 'Kid key', profileId: kid })
    const session = verifyBearerToken(db, token)!
    expect(session.householdId).toBe(householdId)
    expect(session.profileId).toBe(kid)
    expect(session.role).toBe('kid')
  })

  it('rejects unknown tokens', () => {
    expect(verifyBearerToken(db, `bb_${'0'.repeat(48)}`)).toBeNull()
  })

  it('rejects revoked tokens', () => {
    const created = createApiKey(db, { householdId, name: 'Doomed' })
    expect(verifyBearerToken(db, created.token)).not.toBeNull()
    revokeApiKey(db, householdId, created.id)
    expect(verifyBearerToken(db, created.token)).toBeNull()
  })

  it('rejects a key bound to an archived profile', () => {
    const created = createApiKey(db, { householdId, name: 'Mom key', profileId: mom })
    db.update(profiles).set({ archivedAt: new Date() }).where(eq(profiles.id, mom)).run()
    expect(verifyBearerToken(db, created.token)).toBeNull()
  })

  it('records lastUsedAt on use', () => {
    const created = createApiKey(db, { householdId, name: 'HA' })
    expect(keyRow(created.id).lastUsedAt).toBeNull()
    verifyBearerToken(db, created.token)
    expect(keyRow(created.id).lastUsedAt).not.toBeNull()
  })
})

describe('listApiKeys', () => {
  it('lists keys with profile names and never exposes hashes or tokens', () => {
    createApiKey(db, { householdId, name: 'Unbound' })
    const bound = createApiKey(db, { householdId, name: 'Bound', profileId: mom })
    revokeApiKey(db, householdId, bound.id)

    const list = listApiKeys(db, householdId)
    expect(list).toHaveLength(2)

    const boundDto = list.find(k => k.id === bound.id)!
    expect(boundDto.profileName).toBe('Mom')
    expect(boundDto.revoked).toBe(true)
    const unboundDto = list.find(k => k.id !== bound.id)!
    expect(unboundDto.profileId).toBeNull()
    expect(unboundDto.revoked).toBe(false)

    for (const dto of list) {
      expect(dto).not.toHaveProperty('tokenHash')
      expect(dto).not.toHaveProperty('token')
    }
  })

  it('is scoped to the household', () => {
    createApiKey(db, { householdId, name: 'Mine' })
    expect(listApiKeys(db, 'someone-else')).toHaveLength(0)
  })
})

describe('revokeApiKey', () => {
  it('revokes, tolerates a second revoke, and misses unknown ids', () => {
    const created = createApiKey(db, { householdId, name: 'K' })
    expect(revokeApiKey(db, householdId, created.id)).toBe(true)
    expect(keyRow(created.id).revokedAt).not.toBeNull()
    // Idempotent-safe: revoking again neither throws nor un-revokes.
    expect(revokeApiKey(db, householdId, created.id)).toBe(true)
    expect(keyRow(created.id).revokedAt).not.toBeNull()

    expect(revokeApiKey(db, householdId, 'no-such-key')).toBe(false)
    expect(revokeApiKey(db, 'other-household', created.id)).toBe(false)
  })
})
