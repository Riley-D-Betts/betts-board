import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { createDb, type Db } from '../../server/db/client'
import { choreAssignees, choreExceptions, chores, defaultHouseholdSettings, households, profiles } from '../../server/db/schema'
import { completeChore, getChoreBoard, uncompleteChore } from '../../server/services/chores/board'
import { getCurrentStreak, getLeaderboard, periodBounds } from '../../server/services/chores/scoring'

// Fixed clock: Wednesday 2026-03-11. weekStartsOn 0 → week is [03-08, 03-15).
const TODAY = '2026-03-11'

let db: Db
let householdId: string
let kid: string
let mom: string

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
  kid = db.insert(profiles).values({ householdId, name: 'Kid', color: '#22c55e', role: 'kid' }).returning().get().id
  mom = db.insert(profiles).values({ householdId, name: 'Mom', color: '#ec4899', role: 'admin' }).returning().get().id
})

function makeChore(input: { rrule?: string | null, startDate: string, points?: number, assignees?: string[] }) {
  const row = db.insert(chores).values({
    householdId,
    title: 'Dishes',
    points: input.points ?? 1,
    rrule: input.rrule ?? null,
    startDate: input.startDate,
  }).returning().get()
  db.insert(choreAssignees).values(
    (input.assignees ?? [kid]).map(profileId => ({ choreId: row.id, profileId })),
  ).run()
  return row
}

function complete(choreId: string, profileId: string, dates: string[]) {
  for (const dueDate of dates) {
    completeChore(db, { choreId, profileId, dueDate, completedByProfileId: profileId })
  }
}

describe('getCurrentStreak', () => {
  it('counts a daily chore completed 5 days straight', () => {
    const chore = makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-01' })
    complete(chore.id, kid, ['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11'])
    expect(getCurrentStreak(db, { choreId: chore.id, profileId: kid, today: TODAY })).toBe(5)
  })

  it('a missed expected day breaks the streak', () => {
    const chore = makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-01' })
    complete(chore.id, kid, ['2026-03-08', '2026-03-09', '2026-03-11']) // gap on 03-10
    expect(getCurrentStreak(db, { choreId: chore.id, profileId: kid, today: TODAY })).toBe(1)
  })

  it('an incomplete TODAY does not break the streak', () => {
    const chore = makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-01' })
    complete(chore.id, kid, ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'])
    expect(getCurrentStreak(db, { choreId: chore.id, profileId: kid, today: TODAY })).toBe(5)
  })

  it('a weekly chore streak counts consecutive weeks', () => {
    // Mondays: expected ≤ today are 02-02 … 02-23, 03-02, 03-09.
    const chore = makeChore({ rrule: 'FREQ=WEEKLY;BYDAY=MO', startDate: '2026-02-02' })
    complete(chore.id, kid, ['2026-02-23', '2026-03-02', '2026-03-09'])
    expect(getCurrentStreak(db, { choreId: chore.id, profileId: kid, today: TODAY })).toBe(3)
  })

  it('missing the most recent past occurrence resets a weekly streak to 0', () => {
    const chore = makeChore({ rrule: 'FREQ=WEEKLY;BYDAY=MO', startDate: '2026-02-02' })
    complete(chore.id, kid, ['2026-02-23', '2026-03-02']) // 03-09 missed
    expect(getCurrentStreak(db, { choreId: chore.id, profileId: kid, today: TODAY })).toBe(0)
  })

  it('streak on completions only counts each assignee separately', () => {
    const chore = makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-01', assignees: [kid, mom] })
    complete(chore.id, kid, ['2026-03-10', '2026-03-11'])
    complete(chore.id, mom, ['2026-03-11'])
    expect(getCurrentStreak(db, { choreId: chore.id, profileId: kid, today: TODAY })).toBe(2)
    expect(getCurrentStreak(db, { choreId: chore.id, profileId: mom, today: TODAY })).toBe(1)
  })
})

describe('getLeaderboard', () => {
  it('pointsAwarded snapshot survives later chore point edits', () => {
    const chore = makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-01', points: 5 })
    complete(chore.id, kid, ['2026-03-08', '2026-03-09', '2026-03-10'])
    db.update(chores).set({ points: 10 }).where(eq(chores.id, chore.id)).run()
    complete(chore.id, kid, ['2026-03-11'])

    const rows = getLeaderboard(db, { householdId, period: 'all', today: TODAY })
    const kidRow = rows.find(r => r.profileId === kid)!
    expect(kidRow.points).toBe(3 * 5 + 10)
    expect(kidRow.completedCount).toBe(4)
    expect(kidRow.currentStreak).toBe(4)
  })

  it('respects period bounds (week / month / all)', () => {
    const chore = makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-01-01', points: 2 })
    complete(chore.id, kid, ['2026-02-20', '2026-03-06', '2026-03-09'])

    const week = getLeaderboard(db, { householdId, period: 'week', today: TODAY })
    expect(week.find(r => r.profileId === kid)).toMatchObject({ points: 2, completedCount: 1 })

    const month = getLeaderboard(db, { householdId, period: 'month', today: TODAY })
    expect(month.find(r => r.profileId === kid)).toMatchObject({ points: 4, completedCount: 2 })

    const all = getLeaderboard(db, { householdId, period: 'all', today: TODAY })
    expect(all.find(r => r.profileId === kid)).toMatchObject({ points: 6, completedCount: 3 })

    // Uninvolved profiles still get a zero row.
    expect(all.find(r => r.profileId === mom)).toMatchObject({ points: 0, completedCount: 0, currentStreak: 0 })
  })

  it('sorts by points descending', () => {
    const chore = makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-01', points: 3, assignees: [kid, mom] })
    complete(chore.id, mom, ['2026-03-10', '2026-03-11'])
    complete(chore.id, kid, ['2026-03-11'])
    const rows = getLeaderboard(db, { householdId, period: 'week', today: TODAY })
    expect(rows.map(r => r.profileId)).toEqual([mom, kid])
  })
})

describe('getChoreBoard', () => {
  it('cross-joins dates × assignees, minus exceptions, with completion state', () => {
    const chore = makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-01', assignees: [kid, mom] })
    complete(chore.id, kid, ['2026-03-09'])
    db.insert(choreExceptions).values({ choreId: chore.id, dueDate: '2026-03-10' }).run()

    const out = getChoreBoard(db, { householdId, startDate: '2026-03-09', endDate: '2026-03-12' })
    // 3 window dates minus the skipped 03-10, × 2 assignees.
    expect(out).toHaveLength(4)
    expect(out.map(i => i.dueDate)).toEqual(['2026-03-09', '2026-03-09', '2026-03-11', '2026-03-11'])
    expect(out.find(i => i.profileId === kid && i.dueDate === '2026-03-09')).toMatchObject({
      completed: true,
      title: 'Dishes',
      hasRecurrence: true,
    })
    expect(out.find(i => i.profileId === mom && i.dueDate === '2026-03-09')!.completed).toBe(false)
  })

  it('one-off chores appear only when startDate falls in the window', () => {
    makeChore({ rrule: null, startDate: '2026-03-10' })
    expect(getChoreBoard(db, { householdId, startDate: '2026-03-09', endDate: '2026-03-12' })).toHaveLength(1)
    expect(getChoreBoard(db, { householdId, startDate: '2026-03-11', endDate: '2026-03-15' })).toHaveLength(0)
  })

  it('uncompleteChore undoes a completion', () => {
    const chore = makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-01' })
    complete(chore.id, kid, ['2026-03-11'])
    uncompleteChore(db, { choreId: chore.id, profileId: kid, dueDate: '2026-03-11' })
    const out = getChoreBoard(db, { householdId, startDate: '2026-03-11', endDate: '2026-03-12' })
    expect(out[0]!.completed).toBe(false)
  })
})

describe('periodBounds', () => {
  it('computes the current week from weekStartsOn', () => {
    expect(periodBounds('week', TODAY, 0)).toEqual({ start: '2026-03-08', end: '2026-03-15' })
    expect(periodBounds('week', TODAY, 1)).toEqual({ start: '2026-03-09', end: '2026-03-16' })
    // Today on the week boundary starts a fresh week.
    expect(periodBounds('week', '2026-03-08', 0)).toEqual({ start: '2026-03-08', end: '2026-03-15' })
  })

  it('computes calendar month bounds, rolling over December', () => {
    expect(periodBounds('month', TODAY, 0)).toEqual({ start: '2026-03-01', end: '2026-04-01' })
    expect(periodBounds('month', '2026-12-15', 0)).toEqual({ start: '2026-12-01', end: '2027-01-01' })
    expect(periodBounds('all', TODAY, 0)).toBeNull()
  })
})
