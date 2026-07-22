import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { ApiKeyCreated, ApiKeyDto } from '#shared/schemas/apiKeys'
import type { Db } from '../../db/client'
import { apiKeys, profiles } from '../../db/schema'
import type { BoardSession } from '../../utils/session'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function toDto(row: typeof apiKeys.$inferSelect, profileName: string | null): ApiKeyDto {
  return {
    id: row.id,
    name: row.name,
    profileId: row.profileId,
    profileName,
    lastUsedAt: row.lastUsedAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
    revoked: row.revokedAt != null,
  }
}

/** Create a key; the bearer token is returned ONCE and only its hash stored. */
export function createApiKey(db: Db, args: { householdId: string, name: string, profileId?: string | null }): ApiKeyCreated {
  const token = `bb_${randomBytes(24).toString('hex')}`
  const row = db.insert(apiKeys).values({
    householdId: args.householdId,
    name: args.name,
    profileId: args.profileId ?? null,
    tokenHash: hashToken(token),
  }).returning().get()
  const profile = row.profileId
    ? db.select().from(profiles).where(eq(profiles.id, row.profileId)).get()
    : undefined
  return { ...toDto(row, profile?.name ?? null), token }
}

export function listApiKeys(db: Db, householdId: string): ApiKeyDto[] {
  return db.select({ key: apiKeys, profileName: profiles.name })
    .from(apiKeys)
    .leftJoin(profiles, eq(profiles.id, apiKeys.profileId))
    .where(eq(apiKeys.householdId, householdId))
    .all()
    .map(r => toDto(r.key, r.profileName))
}

export function revokeApiKey(db: Db, householdId: string, keyId: string): boolean {
  const updated = db.update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.householdId, householdId)))
    .returning()
    .get()
  return !!updated
}

const LAST_USED_WRITE_INTERVAL_MS = 60_000

/** Resolve a bearer token to a session, or null. Used by the auth middleware. */
export function verifyBearerToken(db: Db, token: string): BoardSession | null {
  const row = db.select().from(apiKeys)
    .where(and(eq(apiKeys.tokenHash, hashToken(token)), isNull(apiKeys.revokedAt)))
    .get()
  if (!row) return null

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id)).run()
  }

  let role: BoardSession['role']
  if (row.profileId) {
    const profile = db.select().from(profiles).where(eq(profiles.id, row.profileId)).get()
    if (!profile || profile.archivedAt) return null // bound profile gone → key unusable
    role = profile.role
  }
  return {
    unlocked: true,
    householdId: row.householdId,
    profileId: row.profileId ?? undefined,
    role,
  }
}
