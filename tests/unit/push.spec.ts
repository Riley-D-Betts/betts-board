import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { DateTime } from 'luxon'
import { createDb, type Db } from '../../server/db/client'
import {
  choreAssignees,
  choreCompletions,
  chores,
  defaultHouseholdSettings,
  households,
  notificationLog,
  profiles,
  pushSubscriptions,
} from '../../server/db/schema'
import { createEvent } from '../../server/services/calendar/events'
import { dispatchChoreReminders, dispatchEventReminders } from '../../server/services/push/dispatch'
import type { PushPayload } from '../../server/services/push/send'
import { getVapidKeys } from '../../server/services/push/vapid'

const ZONE = 'America/Boise'
const boise = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toMillis()

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
    timezone: ZONE,
    icsToken: 'tok',
    settings: defaultHouseholdSettings,
  }).returning().get()
  householdId = hh.id
  mom = db.insert(profiles).values({ householdId, name: 'Mom', color: '#ec4899' }).returning().get().id
  kid = db.insert(profiles).values({ householdId, name: 'Kid', color: '#22c55e' }).returning().get().id
})

function addSub(profileId: string | null, endpoint: string) {
  return db.insert(pushSubscriptions).values({
    householdId,
    profileId,
    endpoint,
    p256dh: 'p',
    auth: 'a',
  }).returning().get()
}

function mockSender() {
  const sent: { profileId: string | null, payload: PushPayload }[] = []
  const send = async (_db: Db, sub: { profileId: string | null }, payload: PushPayload) => {
    sent.push({ profileId: sub.profileId, payload })
    return true
  }
  return { sent, send }
}

describe('getVapidKeys', () => {
  it('generates and persists a key pair on first call, then reuses it', () => {
    const first = getVapidKeys(db)!
    expect(first.publicKey).toBeTruthy()
    expect(first.privateKey).toBeTruthy()

    const row = db.select().from(households).limit(1).get()!
    expect(row.vapidPublicKey).toBe(first.publicKey)
    expect(row.vapidPrivateKey).toBe(first.privateKey)

    expect(getVapidKeys(db)).toEqual(first)
  })
})

describe('dispatchEventReminders', () => {
  it('notifies attendee subscriptions inside the reminder window, exactly once', async () => {
    createEvent(db, householdId, {
      title: 'Dentist',
      isAllDay: false,
      startAt: boise('2026-02-03T14:00:00'),
      endAt: boise('2026-02-03T15:00:00'),
      timezone: ZONE,
      reminderMinutes: [10],
      attendeeProfileIds: [mom],
    })
    addSub(mom, 'https://push.example/mom')
    addSub(kid, 'https://push.example/kid')

    const { sent, send } = mockSender()
    const args = { householdId, timezone: ZONE, now: boise('2026-02-03T13:55:00'), send }

    await dispatchEventReminders(db, args)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.profileId).toBe(mom)
    expect(sent[0]!.payload.title).toBe('Dentist')
    expect(sent[0]!.payload.body).toBe('in 5m at 2:00 PM')

    // Second run in the same window: the log makes it a no-op.
    await dispatchEventReminders(db, args)
    expect(sent).toHaveLength(1)
    expect(db.select().from(notificationLog).all()).toHaveLength(1)
  })

  it('does not fire before the window and includes location in the body', async () => {
    createEvent(db, householdId, {
      title: 'Soccer',
      location: 'City Park',
      isAllDay: false,
      startAt: boise('2026-02-03T17:00:00'),
      endAt: boise('2026-02-03T18:00:00'),
      timezone: ZONE,
      reminderMinutes: [15],
      attendeeProfileIds: [kid],
    })
    addSub(kid, 'https://push.example/kid')

    const { sent, send } = mockSender()
    // 30 min out — not yet inside the 15 min reminder window.
    await dispatchEventReminders(db, { householdId, timezone: ZONE, now: boise('2026-02-03T16:30:00'), send })
    expect(sent).toHaveLength(0)

    await dispatchEventReminders(db, { householdId, timezone: ZONE, now: boise('2026-02-03T16:46:00'), send })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.payload.body).toBe('in 14m at 5:00 PM — City Park')
  })

  it('falls back to the whole household when the event has no attendees', async () => {
    createEvent(db, householdId, {
      title: 'Trash night',
      isAllDay: false,
      startAt: boise('2026-02-03T20:00:00'),
      endAt: boise('2026-02-03T20:30:00'),
      timezone: ZONE,
      reminderMinutes: [30],
      attendeeProfileIds: [],
    })
    addSub(mom, 'https://push.example/mom')
    addSub(kid, 'https://push.example/kid')

    const { sent, send } = mockSender()
    await dispatchEventReminders(db, { householdId, timezone: ZONE, now: boise('2026-02-03T19:45:00'), send })
    expect(sent.map(s => s.profileId).sort()).toEqual([kid, mom].sort())
  })
})

describe('dispatchChoreReminders', () => {
  function addChore(input: { title: string, dueTime: string | null, emoji?: string, assignee: string, startDate?: string }) {
    const chore = db.insert(chores).values({
      householdId,
      title: input.title,
      emoji: input.emoji ?? null,
      startDate: input.startDate ?? '2026-02-03',
      dueTime: input.dueTime,
    }).returning().get()
    db.insert(choreAssignees).values({ choreId: chore.id, profileId: input.assignee }).run()
    return chore
  }

  it('nudges the assignee inside the 30 min before dueTime, exactly once', async () => {
    addChore({ title: 'Dishes', emoji: '🍽️', dueTime: '18:00', assignee: kid })
    addSub(mom, 'https://push.example/mom')
    addSub(kid, 'https://push.example/kid')

    const { sent, send } = mockSender()

    // Too early.
    await dispatchChoreReminders(db, { householdId, timezone: ZONE, now: boise('2026-02-03T17:00:00'), send })
    expect(sent).toHaveLength(0)

    const args = { householdId, timezone: ZONE, now: boise('2026-02-03T17:40:00'), send }
    await dispatchChoreReminders(db, args)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.profileId).toBe(kid)
    expect(sent[0]!.payload.title).toBe('🍽️ Dishes')
    expect(sent[0]!.payload.body).toBe('Due at 6:00 PM — Kid')

    // Idempotent on re-run.
    await dispatchChoreReminders(db, args)
    expect(sent).toHaveLength(1)
  })

  it('skips completed instances and chores without a dueTime', async () => {
    const done = addChore({ title: 'Laundry', dueTime: '18:00', assignee: kid })
    addChore({ title: 'Read a book', dueTime: null, assignee: kid })
    db.insert(choreCompletions).values({
      choreId: done.id,
      profileId: kid,
      dueDate: '2026-02-03',
      completedAt: new Date(),
      pointsAwarded: 1,
    }).run()
    addSub(kid, 'https://push.example/kid')

    const { sent, send } = mockSender()
    await dispatchChoreReminders(db, { householdId, timezone: ZONE, now: boise('2026-02-03T17:45:00'), send })
    expect(sent).toHaveLength(0)
  })
})
