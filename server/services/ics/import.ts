import ical from 'node-ical'
import type { DateWithTimeZone, VEvent } from 'node-ical'
import { eq, inArray } from 'drizzle-orm'
import { IANAZone } from 'luxon'
import { addDaysToDateString, toDateString } from '#shared/utils/dates'
import type { Db } from '../../db/client'
import { calendarFeeds, eventExceptions, events, households } from '../../db/schema'
import { encodeDateKey } from '../calendar/expand'
import { computeDateRecurrenceEnd, computeRecurrenceEnd } from '../calendar/recurrence'

type FeedRow = typeof calendarFeeds.$inferSelect

export interface RefreshFeedOptions {
  /** Test hook: skip the network fetch and parse this text instead. */
  icsText?: string
  /** Test hook: replace the fetch step entirely. */
  fetchIcs?: (url: string) => Promise<string>
}

export interface RefreshResult {
  ok: boolean
  imported: number
  deleted: number
  error?: string
}

/** webcal:// is just https:// with a hint to open a calendar app. */
export function normalizeFeedUrl(url: string): string {
  return url.replace(/^webcal:\/\//i, 'https://')
}

async function fetchIcsText(url: string): Promise<string> {
  const res = await fetch(normalizeFeedUrl(url), {
    signal: AbortSignal.timeout(15_000),
    headers: { accept: 'text/calendar, text/plain, */*' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}

/** node-ical returns plain values or { params, val } wrappers. */
function textVal(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'object' && 'val' in v) return String((v as { val: unknown }).val ?? '') || null
  return null
}

/** node-ical builds dateOnly Dates at LOCAL midnight — read local getters. */
function dateOnlyString(d: Date): string {
  return toDateString(d)
}

function pickZone(...candidates: (string | undefined | null)[]): string | null {
  for (const c of candidates) {
    if (c && IANAZone.isValidZone(c)) return c
  }
  return null
}

/** rrule.toString() may include a DTSTART line — keep only the bare RRULE body. */
function extractRruleBody(rrule: { toString: () => string }): string | null {
  const lines = rrule.toString().replace(/\r\n/g, '\n').split('\n')
    .map(l => l.trim()).filter(Boolean)
  const line = lines.find(l => l.startsWith('RRULE:')) ?? lines.at(-1)
  if (!line) return null
  return line.replace(/^RRULE:/, '') || null
}

interface ParsedException {
  occurrenceStart: number
  kind: 'skipped' | 'modified'
  newStartAt: Date | null
  newEndAt: Date | null
  newTitle: string | null
  newLocation: string | null
  newDescription: string | null
}

interface ParsedEvent {
  uid: string
  title: string
  description: string | null
  location: string | null
  isAllDay: boolean
  startAt: Date | null
  endAt: Date | null
  startDate: string | null
  endDate: string | null
  timezone: string
  rrule: string | null
  recurrenceEnd: Date | null
  exceptions: ParsedException[]
}

/** Key an EXDATE / RECURRENCE-ID instant the way event_exceptions expects it. */
function exceptionKey(d: DateWithTimeZone, isAllDay: boolean): number {
  return isAllDay || d.dateOnly ? encodeDateKey(dateOnlyString(d)) : d.getTime()
}

function mapVEvent(v: VEvent, calendarTz: string | null, householdTz: string): ParsedEvent | null {
  if (!v.uid || !(v.start instanceof Date)) return null

  const isAllDay = v.datetype === 'date' || v.start.dateOnly === true
  const timezone = pickZone(v.start.tz, calendarTz, householdTz) ?? 'UTC'
  const title = textVal(v.summary) ?? '(untitled)'

  let startAt: Date | null = null
  let endAt: Date | null = null
  let startDate: string | null = null
  let endDate: string | null = null

  if (isAllDay) {
    startDate = dateOnlyString(v.start)
    // node-ical derives the implicit +1 day DTEND; guard anyway (DTEND exclusive).
    endDate = v.end instanceof Date ? dateOnlyString(v.end) : null
    if (!endDate || endDate <= startDate) endDate = addDaysToDateString(startDate, 1)
  }
  else {
    startAt = v.start
    endAt = v.end instanceof Date && v.end.getTime() >= v.start.getTime() ? v.end : v.start
  }

  let rrule: string | null = null
  let recurrenceEnd: Date | null = null
  if (v.rrule) {
    rrule = extractRruleBody(v.rrule)
    if (rrule) {
      try {
        recurrenceEnd = isAllDay
          ? (() => {
              const last = computeDateRecurrenceEnd(rrule!, startDate!)
              return last ? new Date(encodeDateKey(last) + 86_400_000) : null
            })()
          : (() => {
              const ms = computeRecurrenceEnd(rrule!, startAt!.getTime(), timezone, endAt!.getTime() - startAt!.getTime())
              return ms == null ? null : new Date(ms)
            })()
      }
      catch {
        // Our expansion engine can't parse this rule — import as a one-off.
        rrule = null
        recurrenceEnd = null
      }
    }
  }

  // EXDATE → skipped; RECURRENCE-ID overrides → modified. node-ical records
  // both under dual keys (date-only + full ISO), so dedupe by computed key.
  const byKey = new Map<number, ParsedException>()

  if (rrule && v.exdate) {
    for (const d of Object.values(v.exdate)) {
      if (!(d instanceof Date)) continue
      const key = exceptionKey(d, isAllDay)
      byKey.set(key, {
        occurrenceStart: key,
        kind: 'skipped',
        newStartAt: null,
        newEndAt: null,
        newTitle: null,
        newLocation: null,
        newDescription: null,
      })
    }
  }

  if (rrule && v.recurrences) {
    const seen = new Set<number>()
    for (const ov of Object.values(v.recurrences)) {
      const rid = ov.recurrenceid
      if (!(rid instanceof Date)) continue
      const key = exceptionKey(rid, isAllDay)
      if (seen.has(key)) continue
      seen.add(key)
      byKey.set(key, {
        occurrenceStart: key,
        kind: 'modified',
        // All-day occurrences can't move in the exception model — keep sparse.
        newStartAt: !isAllDay && ov.start instanceof Date ? ov.start : null,
        newEndAt: !isAllDay && ov.end instanceof Date ? ov.end : null,
        newTitle: textVal(ov.summary),
        newLocation: textVal(ov.location),
        newDescription: textVal(ov.description),
      })
    }
  }

  return {
    uid: v.uid,
    title,
    description: textVal(v.description),
    location: textVal(v.location),
    isAllDay,
    startAt,
    endAt,
    startDate,
    endDate,
    timezone,
    rrule,
    recurrenceEnd,
    exceptions: [...byKey.values()],
  }
}

/**
 * Fetch + parse a feed and sync its VEVENTs into the events table
 * (upsert on feedId+externalUid, delete vanished uids, rebuild exceptions).
 * Never throws: failures land in the feed's lastStatus/lastError.
 */
export async function refreshFeed(db: Db, feed: FeedRow, opts: RefreshFeedOptions = {}): Promise<RefreshResult> {
  try {
    const icsText = opts.icsText ?? await (opts.fetchIcs ?? fetchIcsText)(feed.url)
    const parsed = ical.sync.parseICS(icsText)

    const householdTz = db.select().from(households)
      .where(eq(households.id, feed.householdId)).get()?.timezone ?? 'UTC'
    const calendarTz = pickZone(parsed.vcalendar?.['WR-TIMEZONE'])

    const mapped: ParsedEvent[] = []
    for (const entry of Object.values(parsed)) {
      if (!entry || (entry as { type?: string }).type !== 'VEVENT') continue
      const p = mapVEvent(entry as VEvent, calendarTz, householdTz)
      if (p) mapped.push(p)
    }

    const { imported, deleted } = db.transaction((tx) => {
      const existing = tx.select().from(events).where(eq(events.feedId, feed.id)).all()
      const byUid = new Map(existing.map(e => [e.externalUid!, e]))
      const seenUids = new Set<string>()

      for (const p of mapped) {
        if (seenUids.has(p.uid)) continue // duplicate UID within one feed
        seenUids.add(p.uid)

        const values = {
          householdId: feed.householdId,
          title: p.title,
          description: p.description,
          location: p.location,
          isAllDay: p.isAllDay,
          startAt: p.startAt,
          endAt: p.endAt,
          startDate: p.startDate,
          endDate: p.endDate,
          timezone: p.timezone,
          rrule: p.rrule,
          recurrenceEnd: p.recurrenceEnd,
          feedId: feed.id,
          externalUid: p.uid,
        }

        const prev = byUid.get(p.uid)
        let eventId: string
        if (prev) {
          tx.update(events).set(values).where(eq(events.id, prev.id)).run()
          tx.delete(eventExceptions).where(eq(eventExceptions.eventId, prev.id)).run()
          eventId = prev.id
        }
        else {
          eventId = tx.insert(events).values(values).returning().get().id
        }

        if (p.exceptions.length) {
          tx.insert(eventExceptions).values(p.exceptions.map(ex => ({
            eventId,
            occurrenceStart: new Date(ex.occurrenceStart),
            kind: ex.kind,
            newStartAt: ex.newStartAt,
            newEndAt: ex.newEndAt,
            newTitle: ex.newTitle,
            newLocation: ex.newLocation,
            newDescription: ex.newDescription,
          }))).run()
        }
      }

      const vanished = existing.filter(e => !seenUids.has(e.externalUid!)).map(e => e.id)
      if (vanished.length) {
        tx.delete(events).where(inArray(events.id, vanished)).run()
      }

      return { imported: seenUids.size, deleted: vanished.length }
    })

    db.update(calendarFeeds).set({
      lastFetchedAt: new Date(),
      lastStatus: 'ok',
      lastError: null,
    }).where(eq(calendarFeeds.id, feed.id)).run()

    return { ok: true, imported, deleted }
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    db.update(calendarFeeds).set({
      lastStatus: 'error',
      lastError: message,
    }).where(eq(calendarFeeds.id, feed.id)).run()
    return { ok: false, imported: 0, deleted: 0, error: message }
  }
}
