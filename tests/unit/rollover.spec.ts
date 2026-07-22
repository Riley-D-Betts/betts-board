import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { addDaysToDateString } from '#shared/utils/dates'
import { createDb, type Db } from '../../server/db/client'
import { choreAssignees, choreExceptions, chores, defaultHouseholdSettings, households, profiles } from '../../server/db/schema'
import { completeChore, getChoreBoard, ROLLOVER_LOOKBACK_DAYS } from '../../server/services/chores/board'

// Fixed clock: Wednesday 2026-03-11 (matches streaks.spec.ts).
const TODAY = '2026-03-11'
const TOMORROW = '2026-03-12'

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

function makeChore(input: {
  rrule?: string | null
  startDate: string
  stacking?: boolean
  assignees?: string[]
  title?: string
}) {
  const row = db.insert(chores).values({
    householdId,
    title: input.title ?? 'Laundry',
    rrule: input.rrule ?? null,
    startDate: input.startDate,
    stacking: input.stacking ?? false,
  }).returning().get()
  db.insert(choreAssignees).values(
    (input.assignees ?? [kid]).map(profileId => ({ choreId: row.id, profileId })),
  ).run()
  return row
}

function todayBoard(today = TODAY) {
  return getChoreBoard(db, {
    householdId,
    startDate: today,
    endDate: addDaysToDateString(today, 1),
    today,
  })
}

describe('rollover — stacking', () => {
  it('daily chore missed yesterday shows two independent instances today', () => {
    const chore = makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-10', stacking: true })

    let out = todayBoard()
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ dueDate: '2026-03-10', overdue: true, daysLate: 1, completed: false })
    expect(out[1]).toMatchObject({ dueDate: TODAY, completed: false })
    expect(out[1]!.overdue).toBeUndefined()

    // Completing yesterday's load by its ORIGINAL dueDate leaves today's.
    completeChore(db, { choreId: chore.id, profileId: kid, dueDate: '2026-03-10' })
    out = todayBoard()
    expect(out).toHaveLength(1)
    expect(out[0]!.dueDate).toBe(TODAY)
    expect(out[0]!.overdue).toBeUndefined()

    // And completing today's by its own dueDate works independently.
    completeChore(db, { choreId: chore.id, profileId: kid, dueDate: TODAY })
    out = todayBoard()
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ dueDate: TODAY, completed: true })
  })

  it('completion holes: missed Mon, did Tue+Thu, missed Wed → Friday shows Mon + Wed + Fri', () => {
    const chore = makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-09', stacking: true })
    completeChore(db, { choreId: chore.id, profileId: kid, dueDate: '2026-03-10' }) // Tue
    completeChore(db, { choreId: chore.id, profileId: kid, dueDate: '2026-03-12' }) // Thu

    const friday = '2026-03-13'
    const out = todayBoard(friday)
    expect(out.map(i => i.dueDate)).toEqual(['2026-03-09', '2026-03-11', friday])
    expect(out[0]).toMatchObject({ overdue: true, daysLate: 4 })
    expect(out[1]).toMatchObject({ overdue: true, daysLate: 2 })
    expect(out[2]!.overdue).toBeUndefined()
  })

  it('rollovers are computed per assignee', () => {
    const chore = makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-10', stacking: true, assignees: [kid, mom] })
    completeChore(db, { choreId: chore.id, profileId: kid, dueDate: '2026-03-10' })

    const rolled = todayBoard().filter(i => i.overdue)
    expect(rolled).toHaveLength(1)
    expect(rolled[0]).toMatchObject({ profileId: mom, dueDate: '2026-03-10', daysLate: 1 })
  })

  it('caps the lookback at ROLLOVER_LOOKBACK_DAYS', () => {
    makeChore({ rrule: 'FREQ=DAILY', startDate: addDaysToDateString(TODAY, -40), stacking: true })

    const out = todayBoard()
    expect(out).toHaveLength(ROLLOVER_LOOKBACK_DAYS + 1) // 30 rolled misses + today's
    expect(out[0]).toMatchObject({
      dueDate: addDaysToDateString(TODAY, -ROLLOVER_LOOKBACK_DAYS),
      overdue: true,
      daysLate: ROLLOVER_LOOKBACK_DAYS,
    })
  })
})

describe('rollover — non-stacking (merge)', () => {
  it('daily chore missed yesterday shows exactly one instance today, no overdue extra', () => {
    makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-10', stacking: false, title: 'Mow the lawn' })

    const out = todayBoard()
    expect(out).toHaveLength(1)
    expect(out[0]!.dueDate).toBe(TODAY)
    expect(out[0]!.overdue).toBeUndefined()
  })

  it('weekly chore missed 3 days ago keeps showing (merged to the latest miss) until done', () => {
    // Sundays 03-01 and 03-08 both missed; nothing scheduled Wednesday.
    const chore = makeChore({ rrule: 'FREQ=WEEKLY;BYDAY=SU', startDate: '2026-03-01', stacking: false, title: 'Mow the lawn' })

    let out = todayBoard()
    expect(out).toHaveLength(1) // older miss (03-01) merged away
    expect(out[0]).toMatchObject({ dueDate: '2026-03-08', overdue: true, daysLate: 3, completed: false })

    // Completing it by the original dueDate clears the backlog — gone tomorrow.
    completeChore(db, { choreId: chore.id, profileId: kid, dueDate: '2026-03-08' })
    expect(todayBoard()).toHaveLength(0)
    expect(todayBoard(TOMORROW)).toHaveLength(0)
  })

  it('a completion on or after the latest occurrence suppresses older misses', () => {
    const chore = makeChore({ rrule: 'FREQ=WEEKLY;BYDAY=SU', startDate: '2026-03-01', stacking: false })
    completeChore(db, { choreId: chore.id, profileId: kid, dueDate: '2026-03-08' }) // 03-01 still missed
    expect(todayBoard()).toHaveLength(0)
  })

  it('a missed one-off keeps rolling until done', () => {
    const chore = makeChore({ rrule: null, startDate: '2026-03-09', stacking: false })

    let out = todayBoard()
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ dueDate: '2026-03-09', overdue: true, daysLate: 2, hasRecurrence: false })

    completeChore(db, { choreId: chore.id, profileId: kid, dueDate: '2026-03-09' })
    expect(todayBoard()).toHaveLength(0)
  })
})

describe('rollover — window and exceptions', () => {
  it('rollovers only attach when today falls inside the query window', () => {
    makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-01', stacking: true })

    const out = getChoreBoard(db, {
      householdId,
      startDate: '2026-03-15',
      endDate: '2026-03-22',
      today: TODAY,
    })
    expect(out).toHaveLength(7) // next week's scheduled days only
    expect(out.every(i => !i.overdue)).toBe(true)
  })

  it('excepted (skipped) dates never roll', () => {
    const chore = makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-09', stacking: true })
    db.insert(choreExceptions).values({ choreId: chore.id, dueDate: '2026-03-10' }).run()

    const out = todayBoard()
    expect(out.map(i => i.dueDate)).toEqual(['2026-03-09', TODAY]) // 03-10 skipped, not rolled

    // Non-stacking: excepting the only miss leaves nothing outstanding.
    const mow = makeChore({ rrule: 'FREQ=WEEKLY;BYDAY=SU', startDate: '2026-03-08', stacking: false, title: 'Mow' })
    db.insert(choreExceptions).values({ choreId: mow.id, dueDate: '2026-03-08' }).run()
    expect(todayBoard().filter(i => i.choreId === mow.id)).toHaveLength(0)
  })

  it('a window covering past days keeps historical rows and adds distinct rollovers under today', () => {
    makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-09', stacking: true })

    const out = getChoreBoard(db, {
      householdId,
      startDate: '2026-03-09',
      endDate: TOMORROW,
      today: TODAY,
    })
    expect(out.map(i => [i.dueDate, !!i.overdue])).toEqual([
      ['2026-03-09', false], // historical rows untouched
      ['2026-03-10', false],
      ['2026-03-09', true], // rollovers attach to today, oldest first
      ['2026-03-10', true],
      [TODAY, false], // today's scheduled last
    ])
  })

  it('omitting today keeps the pre-rollover board behavior', () => {
    makeChore({ rrule: 'FREQ=DAILY', startDate: '2026-03-01', stacking: true })
    const out = getChoreBoard(db, { householdId, startDate: TODAY, endDate: TOMORROW })
    expect(out).toHaveLength(1)
    expect(out[0]!.overdue).toBeUndefined()
  })
})
