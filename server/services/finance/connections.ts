import { and, eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { financeAccounts, financeConnections } from '../../db/schema'
import { claimSetupToken } from './simplefin'
import { credentialsReadable, storeAccessUrl, syncConnection } from './sync'

export interface ConnectionDto {
  id: string
  provider: string
  nickname: string | null
  status: string
  /**
   * Derived at read time, not stored: it is a property of the CURRENT key
   * file, not of the row. Storing it would go stale the moment a key is
   * restored or rotated.
   */
  credentialsReadable: boolean
  syncIntervalMinutes: number
  lastAttemptAt: number | null
  lastSyncAt: number | null
  nextAttemptAt: number | null
  consecutiveFailures: number
  lastError: string | null
  lastErrorList: string[] | null
  accountCount: number
  createdAt: number
}

export function listConnections(db: Db, householdId: string): ConnectionDto[] {
  const rows = db.select().from(financeConnections)
    .where(eq(financeConnections.householdId, householdId)).all()

  return rows.map((c) => {
    const accountCount = db.select({ id: financeAccounts.id }).from(financeAccounts)
      .where(eq(financeAccounts.connectionId, c.id)).all().length
    return {
      id: c.id,
      provider: c.provider,
      nickname: c.nickname,
      status: c.status,
      credentialsReadable: credentialsReadable(c),
      syncIntervalMinutes: c.syncIntervalMinutes,
      lastAttemptAt: c.lastAttemptAt?.getTime() ?? null,
      lastSyncAt: c.lastSyncAt?.getTime() ?? null,
      nextAttemptAt: c.nextAttemptAt?.getTime() ?? null,
      consecutiveFailures: c.consecutiveFailures,
      lastError: c.lastError,
      lastErrorList: c.lastErrorList,
      accountCount,
      createdAt: c.createdAt.getTime(),
    }
  })
}

/**
 * Claims the token and stores the resulting access URL encrypted. The token is
 * exchanged inside this request and never written anywhere — it is single-use,
 * and a stored copy would be a second credential to protect for no benefit.
 */
export async function connectSimpleFin(db: Db, args: {
  householdId: string
  profileId: string
  setupToken: string
  nickname?: string
}): Promise<{ connectionId: string }> {
  const accessUrl = await claimSetupToken(args.setupToken)

  const connection = db.insert(financeConnections).values({
    householdId: args.householdId,
    provider: 'simplefin',
    nickname: args.nickname ?? null,
    accessUrlEnc: storeAccessUrl(accessUrl),
    createdByProfileId: args.profileId,
  }).returning().get()

  // Pull straight away — a connect button that leaves the screen empty for an
  // hour reads as broken. Failures land on the connection row, not here.
  await syncConnection(db, connection)
  return { connectionId: connection.id }
}

/**
 * Re-auth: replaces the access URL on the SAME row, so accounts match by
 * externalId and every category, note, budget, and bill survives.
 */
export async function reconnectSimpleFin(db: Db, args: {
  householdId: string
  connectionId: string
  setupToken: string
}): Promise<void> {
  const connection = getConnection(db, args.householdId, args.connectionId)
  const accessUrl = await claimSetupToken(args.setupToken)

  const updated = db.update(financeConnections).set({
    accessUrlEnc: storeAccessUrl(accessUrl),
    status: 'ok',
    consecutiveFailures: 0,
    lastError: null,
    lastErrorList: null,
    nextAttemptAt: null,
  }).where(eq(financeConnections.id, connection.id)).returning().get()

  await syncConnection(db, updated)
}

export function getConnection(db: Db, householdId: string, id: string) {
  const row = db.select().from(financeConnections)
    .where(and(eq(financeConnections.id, id), eq(financeConnections.householdId, householdId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Connection not found' })
  return row
}

export function patchConnection(db: Db, householdId: string, id: string, patch: {
  nickname?: string | null
  syncIntervalMinutes?: number
  enabled?: boolean
}) {
  const row = getConnection(db, householdId, id)
  const values: Record<string, unknown> = {}
  if (patch.nickname !== undefined) values.nickname = patch.nickname
  if (patch.syncIntervalMinutes !== undefined) values.syncIntervalMinutes = patch.syncIntervalMinutes
  if (patch.enabled !== undefined) {
    values.status = patch.enabled ? 'ok' : 'disabled'
    if (patch.enabled) values.nextAttemptAt = null
  }
  return db.update(financeConnections).set(values).where(eq(financeConnections.id, row.id)).returning().get()
}

/**
 * Disconnect. Cascades to accounts and their transactions — which is the
 * honest behaviour: those rows only ever came from the bank, and leaving
 * orphaned copies behind would quietly double-count on reconnect.
 */
export function deleteConnection(db: Db, householdId: string, id: string): void {
  const row = getConnection(db, householdId, id)
  db.delete(financeConnections).where(eq(financeConnections.id, row.id)).run()
}
