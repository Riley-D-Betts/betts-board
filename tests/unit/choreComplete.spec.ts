import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { createDb, setDb } from '../../server/db/client'
import { choreAssignees, chores, households, profiles } from '../../server/db/schema'
import { defaultHouseholdSettings } from '../../server/db/schema/household'
import { completeChore, completeChoreWithSummary, uncompleteChore } from '../../server/services/chores/board'

let db: Db
let householdId: string
let profileId: string
let choreId: string

function makeChore(points: number, startDate: string, rrule: string | null = 'FREQ=DAILY') {
  const row = db.insert(chores).values({
    householdId,
    title: 'Feed the dog',
    points,
    rrule,
    startDate,
    stacking: false,
  }).returning().get()
  db.insert(choreAssignees).values({ choreId: row.id, profileId }).run()
  return row.id
}

beforeEach(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)

  householdId = db.insert(households).values({
    name: 'Betts',
    passwordHash: 'x',
    timezone: 'America/Boise',
    icsToken: 'tok',
    settings: defaultHouseholdSettings,
  }).returning().get().id

  profileId = db.insert(profiles).values({
    householdId, name: 'Emma', color: '#22c55e', role: 'kid',
  }).returning().get().id

  choreId = makeChore(5, '2026-07-01')
})

describe('completeChoreWithSummary', () => {
  it('returns the points banked and a streak of 1 on the first completion', () => {
    const result = completeChoreWithSummary(db, { choreId, profileId, dueDate: '2026-07-23' }, '2026-07-23')
    expect(result.pointsAwarded).toBe(5)
    expect(result.streak).toBe(1)
  })

  it('counts consecutive days as a streak', () => {
    for (const d of ['2026-07-21', '2026-07-22', '2026-07-23']) {
      completeChore(db, { choreId, profileId, dueDate: d })
    }
    const result = completeChoreWithSummary(db, { choreId, profileId, dueDate: '2026-07-23' }, '2026-07-23')
    expect(result.streak).toBe(3)
  })

  it('breaks the streak when a day is missed', () => {
    completeChore(db, { choreId, profileId, dueDate: '2026-07-20' })
    completeChore(db, { choreId, profileId, dueDate: '2026-07-21' })
    // 07-22 skipped
    const result = completeChoreWithSummary(db, { choreId, profileId, dueDate: '2026-07-23' }, '2026-07-23')
    expect(result.streak).toBe(1)
  })

  it('is idempotent — re-completing the same day does not double-count', () => {
    completeChoreWithSummary(db, { choreId, profileId, dueDate: '2026-07-23' }, '2026-07-23')
    const again = completeChoreWithSummary(db, { choreId, profileId, dueDate: '2026-07-23' }, '2026-07-23')
    expect(again.streak).toBe(1)
    expect(again.pointsAwarded).toBe(5)
  })

  it('snapshots the points at completion time', () => {
    const zeroPoint = makeChore(0, '2026-07-01')
    const result = completeChoreWithSummary(db, { choreId: zeroPoint, profileId, dueDate: '2026-07-23' }, '2026-07-23')
    expect(result.pointsAwarded).toBe(0)
  })

  it('drops the streak back after an undo', () => {
    completeChore(db, { choreId, profileId, dueDate: '2026-07-22' })
    completeChoreWithSummary(db, { choreId, profileId, dueDate: '2026-07-23' }, '2026-07-23')
    uncompleteChore(db, { choreId, profileId, dueDate: '2026-07-23' })
    const after = completeChoreWithSummary(db, { choreId, profileId, dueDate: '2026-07-22' }, '2026-07-22')
    expect(after.streak).toBe(1)
  })

  it('still throws for an unknown chore', () => {
    expect(() => completeChoreWithSummary(db, { choreId: 'nope', profileId, dueDate: '2026-07-23' }, '2026-07-23'))
      .toThrow()
  })
})

describe('completeChore (unchanged contract)', () => {
  it('still returns the bare completion row', () => {
    const row = completeChore(db, { choreId, profileId, dueDate: '2026-07-23' })
    expect(row).toMatchObject({ choreId, profileId, dueDate: '2026-07-23', pointsAwarded: 5 })
    expect(row).not.toHaveProperty('streak')
  })
})
