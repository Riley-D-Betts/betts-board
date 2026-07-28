import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { DateTime } from 'luxon'
import { createDb, type Db } from '../../server/db/client'
import { defaultHouseholdSettings, households, mealPlanEntries, profiles, recipes } from '../../server/db/schema'
import { getCookingOccurrences } from '../../server/services/meals/cooking'

const ZONE = 'America/Boise'
const boise = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toMillis()
const fmt = (ms: number) => DateTime.fromMillis(ms, { zone: ZONE }).toFormat('yyyy-MM-dd HH:mm')

let db: Db
let householdId: string
let mom: string

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
})

function addRecipe(over: Partial<typeof recipes.$inferInsert> = {}) {
  return db.insert(recipes).values({ householdId, title: 'Lasagna', steps: [], ...over }).returning().get()
}

function addEntry(over: Partial<typeof mealPlanEntries.$inferInsert> = {}) {
  return db.insert(mealPlanEntries).values({
    householdId,
    date: '2026-02-03',
    slot: 'dinner',
    ...over,
  }).returning().get()
}

function occurrences(startIso: string, endIso: string, mealTimes?: Partial<Record<'breakfast' | 'lunch' | 'dinner' | 'snack', string>>) {
  return getCookingOccurrences(db, {
    householdId,
    windowStartMs: boise(startIso),
    windowEndMs: boise(endIso),
    timezone: ZONE,
    mealTimes,
  })
}

const FEB_WEEK = ['2026-02-01T00:00:00', '2026-02-08T00:00:00'] as const

describe('getCookingOccurrences', () => {
  it('builds a block ending at dinner sized by totalMinutes + padding', () => {
    const recipe = addRecipe({ totalMinutes: 60 })
    const entry = addEntry({ recipeId: recipe.id, cookProfileId: mom })

    const out = occurrences(...FEB_WEEK)
    expect(out).toHaveLength(1)
    const occ = out[0]!
    expect(fmt(occ.start)).toBe('2026-02-03 16:45') // 60 + 15 min before 18:00
    expect(fmt(occ.end)).toBe('2026-02-03 18:00')
    expect(occ.occurrenceId).toBe(`meal:${entry.id}`)
    expect(occ.eventId).toBe(entry.id)
    expect(occ.kind).toBe('meal')
    // The dish only — the "Cooking — …" label is composed client-side, in the
    // board's language.
    expect(occ.title).toBe('Lasagna')
    expect(occ.isAllDay).toBe(false)
    expect(occ.attendees).toEqual([{ profileId: mom, color: '#ec4899', name: 'Mom' }])
    expect(occ.color).toBe('#ec4899')
    expect(occ.readonly).toBe(true)
    expect(occ.isException).toBe(false)
    expect(occ.hasRecurrence).toBe(false)
    expect(occ.mealEntryId).toBe(entry.id)
    expect(occ.recipeId).toBe(recipe.id)
  })

  it('falls back to prep + cook minutes when totalMinutes is missing', () => {
    const recipe = addRecipe({ prepMinutes: 20, cookMinutes: 25 })
    addEntry({ recipeId: recipe.id, cookProfileId: mom })

    const out = occurrences(...FEB_WEEK)
    expect(out).toHaveLength(1)
    expect(fmt(out[0]!.start)).toBe('2026-02-03 17:00') // 45 + 15 = 60 min block
    expect(fmt(out[0]!.end)).toBe('2026-02-03 18:00')
  })

  it('uses DEFAULT_COOK_MINUTES for recipes with no time info and freeText meals', () => {
    const recipe = addRecipe()
    addEntry({ recipeId: recipe.id, cookProfileId: mom })
    addEntry({ date: '2026-02-04', freeText: 'Leftovers', cookProfileId: mom })

    const out = occurrences(...FEB_WEEK)
    expect(out.map(o => `${o.title}@${fmt(o.start)}`).sort()).toEqual([
      'Lasagna@2026-02-03 17:00', // 45 + 15 = 60 min before 18:00
      'Leftovers@2026-02-04 17:00',
    ])
    expect(out.find(o => o.title === 'Leftovers')!.recipeId).toBeNull()
  })

  it('honors custom household mealTimes with defaults per slot', () => {
    const recipe = addRecipe({ totalMinutes: 30 })
    addEntry({ recipeId: recipe.id, cookProfileId: mom })
    addEntry({ date: '2026-02-04', slot: 'lunch', freeText: 'Soup', cookProfileId: mom })

    const out = occurrences(...FEB_WEEK, { dinner: '19:30' })
    const byTitle = new Map(out.map(o => [o.title, o]))
    expect(fmt(byTitle.get('Lasagna')!.end)).toBe('2026-02-03 19:30')
    expect(fmt(byTitle.get('Lasagna')!.start)).toBe('2026-02-03 18:45')
    // Lunch wasn't overridden → DEFAULT_MEAL_TIMES 12:00.
    expect(fmt(byTitle.get('Soup')!.end)).toBe('2026-02-04 12:00')
  })

  it('ignores entries without a cook', () => {
    const recipe = addRecipe({ totalMinutes: 60 })
    addEntry({ recipeId: recipe.id })
    expect(occurrences(...FEB_WEEK)).toHaveLength(0)
  })

  it('ignores entries whose cook is archived', () => {
    const gone = db.insert(profiles).values({
      householdId,
      name: 'Gone',
      color: '#64748b',
      archivedAt: new Date(),
    }).returning().get()
    addEntry({ freeText: 'Tacos', cookProfileId: gone.id })
    expect(occurrences(...FEB_WEEK)).toHaveLength(0)
  })

  it('filters to the window by the START instant', () => {
    const recipe = addRecipe({ totalMinutes: 60 }) // block 16:45 → 18:00
    addEntry({ recipeId: recipe.id, cookProfileId: mom })

    expect(occurrences('2026-02-03T00:00:00', '2026-02-04T00:00:00')).toHaveLength(1)
    // Window opens after the block starts → excluded.
    expect(occurrences('2026-02-03T17:00:00', '2026-02-04T00:00:00')).toHaveLength(0)
    // Window closes before the block starts → excluded.
    expect(occurrences('2026-02-01T00:00:00', '2026-02-03T00:00:00')).toHaveLength(0)
    // Window closing exactly at the start is exclusive.
    expect(occurrences('2026-02-01T00:00:00', '2026-02-03T16:45:00')).toHaveLength(0)
    expect(occurrences('2026-02-03T16:45:00', '2026-02-04T00:00:00')).toHaveLength(1)
  })

  it('keeps the mealtime wall clock across the DST fall-back day', () => {
    const recipe = addRecipe({ totalMinutes: 60 })
    addEntry({ date: '2026-11-01', recipeId: recipe.id, cookProfileId: mom })

    const out = occurrences('2026-11-01T00:00:00', '2026-11-02T00:00:00')
    expect(out).toHaveLength(1)
    expect(fmt(out[0]!.end)).toBe('2026-11-01 18:00') // still 18:00 wall clock
    expect(fmt(out[0]!.start)).toBe('2026-11-01 16:45')
    expect(out[0]!.end - out[0]!.start).toBe(75 * 60_000)
    // Post-fall-back dinner is in MST (UTC-7).
    expect(DateTime.fromMillis(out[0]!.end, { zone: ZONE }).offset).toBe(-7 * 60)
  })
})
