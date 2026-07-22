import { DateTime } from 'luxon'
import { eq, inArray } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { events, notificationLog, pushSubscriptions } from '../../db/schema'
import { expandEvents } from '../calendar/expand'
import { getChoreBoard } from '../chores/board'
import { sendToSubscription, type PushPayload, type SubscriptionRow } from './send'

type SendFn = (db: Db, sub: SubscriptionRow, payload: PushPayload) => Promise<boolean>

export interface DispatchArgs {
  householdId: string
  timezone: string
  /** Epoch ms "now" — injectable so tests can pin the clock. */
  now: number
  /** Test hook — defaults to the real web-push sender. */
  send?: SendFn
}

/** Look ahead far enough to catch a 24h (1440m) reminder, with slack. */
const EVENT_HORIZON_MS = 25 * 60 * 60 * 1000
/** Chore "due soon" notifications fire inside the 30 min before dueTime. */
const CHORE_LEAD_MS = 30 * 60 * 1000

/** Claim a slot in the idempotency ledger BEFORE sending. False = a previous
 * run already sent this notification to this subscription — skip. */
function claim(db: Db, entry: {
  kind: 'event_reminder' | 'chore_due'
  refId: string
  occurrenceKey: string
  subscriptionId: string
}): boolean {
  const res = db.insert(notificationLog)
    .values({ ...entry, sentAt: new Date() })
    .onConflictDoNothing()
    .run()
  return res.changes > 0
}

function householdSubs(db: Db, householdId: string): SubscriptionRow[] {
  return db.select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.householdId, householdId)).all()
}

/** Event reminders: for each upcoming occurrence whose event has a reminder
 * offset m with start - m*60s <= now < start, notify the attendees'
 * subscriptions (whole household when the event has no attendees). */
export async function dispatchEventReminders(db: Db, args: DispatchArgs): Promise<void> {
  const { householdId, timezone, now } = args
  const send = args.send ?? sendToSubscription

  const subs = householdSubs(db, householdId)
  if (subs.length === 0) return

  const occurrences = expandEvents(db, {
    householdId,
    timezone,
    windowStartMs: now,
    windowEndMs: now + EVENT_HORIZON_MS,
  })
  if (occurrences.length === 0) return

  // Expansion DTOs don't carry reminderMinutes — join back through the events table.
  const eventIds = [...new Set(occurrences.map(o => o.eventId))]
  const remindersByEvent = new Map(
    db.select({ id: events.id, reminderMinutes: events.reminderMinutes })
      .from(events).where(inArray(events.id, eventIds)).all()
      .map(r => [r.id, r.reminderMinutes] as const),
  )

  for (const occ of occurrences) {
    const reminders = remindersByEvent.get(occ.eventId)
    if (!reminders?.length) continue
    if (!reminders.some(m => occ.start - m * 60_000 <= now && now < occ.start)) continue

    const attendeeIds = new Set(occ.attendees.map(a => a.profileId))
    const targets = attendeeIds.size > 0
      ? subs.filter(s => s.profileId && attendeeIds.has(s.profileId))
      : subs

    const minutes = Math.max(1, Math.round((occ.start - now) / 60_000))
    const time = DateTime.fromMillis(occ.start, { zone: timezone }).toFormat('h:mm a')
    const payload: PushPayload = {
      title: occ.title,
      body: `in ${minutes}m at ${time}${occ.location ? ` — ${occ.location}` : ''}`,
      url: '/calendar',
    }

    for (const sub of targets) {
      if (!claim(db, {
        kind: 'event_reminder',
        refId: occ.eventId,
        occurrenceKey: occ.occurrenceId,
        subscriptionId: sub.id,
      })) continue
      await send(db, sub, payload)
    }
  }
}

/** Chore due-soon: instances due today (household tz) with a dueTime get a
 * nudge to the assignee inside the 30 min before dueTime. */
export async function dispatchChoreReminders(db: Db, args: DispatchArgs): Promise<void> {
  const { householdId, timezone, now } = args
  const send = args.send ?? sendToSubscription

  const subs = householdSubs(db, householdId)
  if (subs.length === 0) return

  const today = DateTime.fromMillis(now, { zone: timezone }).toISODate()!
  const tomorrow = DateTime.fromMillis(now, { zone: timezone }).plus({ days: 1 }).toISODate()!
  const instances = getChoreBoard(db, { householdId, startDate: today, endDate: tomorrow })

  for (const inst of instances) {
    if (!inst.dueTime || inst.completed) continue
    const dueMs = DateTime.fromISO(`${inst.dueDate}T${inst.dueTime}`, { zone: timezone }).toMillis()
    if (!(dueMs - CHORE_LEAD_MS <= now && now < dueMs)) continue

    const targets = subs.filter(s => s.profileId === inst.profileId)
    if (targets.length === 0) continue

    const time = DateTime.fromMillis(dueMs, { zone: timezone }).toFormat('h:mm a')
    const payload: PushPayload = {
      title: `${inst.emoji ? `${inst.emoji} ` : ''}${inst.title}`,
      body: `Due at ${time} — ${inst.profileName}`,
      url: '/chores',
    }
    const occurrenceKey = `${inst.choreId}:${inst.dueDate}:${inst.profileId}`

    for (const sub of targets) {
      if (!claim(db, {
        kind: 'chore_due',
        refId: inst.choreId,
        occurrenceKey,
        subscriptionId: sub.id,
      })) continue
      await send(db, sub, payload)
    }
  }
}

/** Everything the minutely notify:dispatch task does. Never throws. */
export async function dispatchDueNotifications(db: Db, args: DispatchArgs): Promise<void> {
  try {
    await dispatchEventReminders(db, args)
  }
  catch (err) {
    console.error('[push] event reminder dispatch failed:', err)
  }
  try {
    await dispatchChoreReminders(db, args)
  }
  catch (err) {
    console.error('[push] chore reminder dispatch failed:', err)
  }
}
