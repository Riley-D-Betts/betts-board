import { and, asc, eq, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import type { ProfileCreate, ProfilePatch } from '#shared/schemas/profiles'
import type { Db } from '../../db/client'
import { profiles } from '../../db/schema'
import { profileDtoColumns, type ProfileDto } from '../../utils/dto'

/**
 * Every read and write of the `profiles` table that ends up in an HTTP
 * response goes through here, and every query names `profileDtoColumns`.
 *
 * The routes under server/api/profiles/ deliberately do not import the table
 * at all: a route cannot forget to strip `pinHash` (the argon2 hash of the
 * Money PIN) if it never has the chance to select it. tests/unit/responseDto
 * .spec.ts asserts both halves — that these functions never emit the hash, and
 * that no profile route touches the schema directly.
 */

export function listProfiles(db: Db): ProfileDto[] {
  return db.select(profileDtoColumns)
    .from(profiles)
    .where(isNull(profiles.archivedAt))
    .orderBy(asc(profiles.sortOrder), asc(profiles.createdAt))
    .all()
}

export function createProfile(db: Db, householdId: string, input: ProfileCreate): ProfileDto {
  return db.insert(profiles).values({
    householdId,
    name: input.name,
    color: input.color,
    role: input.role,
    sortOrder: input.sortOrder ?? 99,
  }).returning(profileDtoColumns).get()
}

/**
 * How many admins the household would still have if nothing changed. The
 * role in a session cookie can be stale (see isAdminProfile), so "who is an
 * admin" is always the live, non-archived rows — never the caller's session.
 */
function adminCount(db: Db): number {
  return db.select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.role, 'admin'), isNull(profiles.archivedAt)))
    .all().length
}

/**
 * Throw if this write would leave the household with zero admins. Guards both
 * demotion (role → non-admin) and removal (archive): either one, applied to the
 * last remaining admin, locks every requireAdmin route out forever. Stepping
 * down is fine as long as another admin exists — this only blocks the last one.
 */
function assertKeepsAnAdmin(db: Db, id: string, removesAdmin: boolean): void {
  if (!removesAdmin) return
  const target = db.select({ role: profiles.role, archivedAt: profiles.archivedAt })
    .from(profiles).where(eq(profiles.id, id)).get()
  if (target && !target.archivedAt && target.role === 'admin' && adminCount(db) <= 1) {
    throw createError({ statusCode: 409, statusMessage: 'The household must keep at least one admin' })
  }
}

export function updateProfile(db: Db, id: string, patch: ProfilePatch): ProfileDto {
  assertKeepsAnAdmin(db, id, patch.archived === true || (patch.role !== undefined && patch.role !== 'admin'))

  const updated = db.update(profiles).set({
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.color !== undefined && { color: patch.color }),
    ...(patch.role !== undefined && { role: patch.role }),
    ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
    ...(patch.archived !== undefined && { archivedAt: patch.archived ? new Date() : null }),
  }).where(eq(profiles.id, id)).returning(profileDtoColumns).get()

  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })
  return updated
}

/** Archive, not hard-delete: completions/events keep their author. */
export function archiveProfile(db: Db, id: string): void {
  assertKeepsAnAdmin(db, id, true)

  const updated = db.update(profiles)
    .set({ archivedAt: new Date() })
    .where(eq(profiles.id, id))
    .returning({ id: profiles.id })
    .get()
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })
}

/**
 * Is the acting profile an admin *right now*?
 *
 * Reads the row rather than trusting `session.role`: the role in a session
 * cookie is a snapshot taken when the profile was chosen, so a profile demoted
 * out of admin keeps an admin-shaped cookie until it switches again. Fine for
 * cosmetics, not fine for deciding who sees a credential.
 */
export function isAdminProfile(db: Db, profileId: string | undefined | null): boolean {
  if (!profileId) return false
  const row = db.select({ role: profiles.role, archivedAt: profiles.archivedAt })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .get()
  return !!row && !row.archivedAt && row.role === 'admin'
}
