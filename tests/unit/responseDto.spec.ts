import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import { calendarFeeds, defaultHouseholdSettings, households, profiles } from '../../server/db/schema'
import { buildBootstrap } from '../../server/services/bootstrap/state'
import { rotateIcsToken } from '../../server/services/household/icsToken'
import {
  archiveProfile, createProfile, isAdminProfile, listProfiles, updateProfile,
} from '../../server/services/profiles/store'
import { toFeedDto, toHouseholdDto, toProfileDto } from '../../server/utils/dto'

/**
 * Secrets that must never reach an HTTP response.
 *
 * Each test here is an attack, not a shape assertion: it looks for the actual
 * secret string anywhere in the serialised payload, so renaming a column or
 * spreading a raw row back in fails the test rather than sliding past it.
 */

const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$SALTSALT$PINHASHSECRET'
const FEED_SECRET = 'private-a1b2c3d4e5f6/basic.ics'
const FEED_URL = `https://calendar.google.com/calendar/ical/${FEED_SECRET}`
const ICS_TOKEN = 'ics-token-that-unlocks-the-whole-calendar'

let db: Db
let householdId: string
let dad: string
let kid: string

beforeAll(() => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
})

beforeEach(() => {
  db.delete(calendarFeeds).run()
  db.delete(profiles).run()
  db.delete(households).run()

  householdId = db.insert(households).values({
    name: 'Betts',
    passwordHash: 'household-password-hash',
    timezone: 'America/Boise',
    latitude: 43.6,
    longitude: -116.2,
    locationName: 'Boise',
    icsToken: ICS_TOKEN,
    githubToken: 'ghp_supersecret',
    vapidPrivateKey: 'vapid-private-key',
    settings: defaultHouseholdSettings,
  }).returning().get().id

  const insert = (name: string, role: 'admin' | 'adult' | 'kid') =>
    db.insert(profiles).values({ householdId, name, color: '#112233', role, pinHash: PIN_HASH })
      .returning().get().id
  dad = insert('Dad', 'admin')
  kid = insert('Kid', 'kid')
})

function household() {
  return db.select().from(households).where(eq(households.id, householdId)).get()!
}

describe('profiles never carry the Money PIN hash out', () => {
  // The attack: any profile can be made admin with one tap, so a kid who
  // promotes themselves could PATCH a profile and read back the argon2 hash of
  // a four-digit PIN — crackable offline in seconds, defeating the money gate.
  it('PATCH-shaped update returns no pinHash', () => {
    // A second admin so demoting Dad isn't blocked by the last-admin guard.
    db.insert(profiles).values({ householdId, name: 'Mum', color: '#112233', role: 'admin' }).run()
    const updated = updateProfile(db, dad, { role: 'kid' })
    expect(updated).not.toHaveProperty('pinHash')
    expect(JSON.stringify(updated)).not.toContain('PINHASHSECRET')
    expect(updated.role).toBe('kid') // …while still doing its job
  })

  it('list, create and row-mapping return no pinHash either', () => {
    const listed = listProfiles(db)
    expect(listed).toHaveLength(2)
    for (const p of listed) expect(p).not.toHaveProperty('pinHash')
    expect(JSON.stringify(listed)).not.toContain('PINHASHSECRET')

    const created = createProfile(db, householdId, { name: 'Mum', color: '#445566', role: 'adult' })
    expect(created).not.toHaveProperty('pinHash')

    const raw = db.select().from(profiles).where(eq(profiles.id, dad)).get()!
    expect(raw.pinHash).toBe(PIN_HASH) // the column is really populated
    expect(toProfileDto(raw)).not.toHaveProperty('pinHash')
  })

  it('still returns the fields the UI renders', () => {
    const [first] = listProfiles(db)
    expect(Object.keys(first!).sort()).toEqual([
      'archivedAt', 'avatarPath', 'color', 'createdAt', 'householdId', 'id', 'name', 'role', 'sortOrder',
    ])
  })

  it('keeps 404 behaviour for unknown ids', () => {
    expect(() => updateProfile(db, 'nope', { name: 'x' })).toThrow(/not found/i)
    expect(() => archiveProfile(db, 'nope')).toThrow(/not found/i)
    archiveProfile(db, kid)
    expect(listProfiles(db).map(p => p.name)).toEqual(['Dad'])
  })

  it('isAdminProfile reads the row, not a cached session role', () => {
    expect(isAdminProfile(db, dad)).toBe(true)
    expect(isAdminProfile(db, kid)).toBe(false)
    expect(isAdminProfile(db, undefined)).toBe(false)
    // Demoted or archived in the database → not an admin any more, even though
    // an already-issued session cookie still claims role: 'admin'. A second
    // admin so the demotion isn't blocked by the last-admin guard.
    db.insert(profiles).values({ householdId, name: 'Mum', color: '#112233', role: 'admin' }).run()
    updateProfile(db, dad, { role: 'adult' })
    expect(isAdminProfile(db, dad)).toBe(false)
  })

  it('no route under server/api/profiles touches the table directly', () => {
    // The structural half of the fix: routes cannot forget to strip a column
    // they are never in a position to select.
    const dir = fileURLToPath(new URL('../../server/api/profiles', import.meta.url))
    const files = readdirSync(dir).filter(f => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(3)
    for (const file of files) {
      expect(readFileSync(join(dir, file), 'utf8'), file).not.toMatch(/db\/schema/)
    }
  })
})

describe('calendar feeds never carry their subscription URL out', () => {
  // The attack: GET /api/feeds is open to every unlocked session, kid profiles
  // included. A private Google/Apple calendar URL is a bearer credential —
  // whoever copies it reads that calendar forever, from anywhere.
  it('exposes the host and nothing else', () => {
    const row = db.insert(calendarFeeds).values({
      householdId, name: 'School', url: FEED_URL,
    }).returning().get()

    const dto = toFeedDto(row)
    expect(dto).not.toHaveProperty('url')
    expect(JSON.stringify(dto)).not.toContain(FEED_SECRET)
    expect(dto.urlHost).toBe('calendar.google.com')
    // Still enough to run the settings list.
    expect(dto.name).toBe('School')
    expect(dto.enabled).toBe(true)
  })

  it('handles webcal and unparseable URLs without leaking them', () => {
    const base = { id: 'f', householdId, name: 'n', color: '#fff', enabled: true,
      fetchIntervalMinutes: 60, lastFetchedAt: null, lastStatus: null, lastError: null,
      createdAt: new Date() }
    expect(toFeedDto({ ...base, url: `webcal://p01-calendars.icloud.com/${FEED_SECRET}` }).urlHost)
      .toBe('p01-calendars.icloud.com')
    const broken = toFeedDto({ ...base, url: `not a url ${FEED_SECRET}` })
    expect(broken.urlHost).toBe('')
    expect(JSON.stringify(broken)).not.toContain(FEED_SECRET)
  })

  it('no route under server/api/feeds returns a raw feed row', () => {
    // GET was the finding, but POST, PATCH and refresh all echoed the row back
    // too. Admin-only lowers the odds, not the damage: the URL is a bearer
    // credential, and it lands in browser devtools, logs and proxies alike.
    const dir = fileURLToPath(new URL('../../server/api/feeds', import.meta.url))
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter(f => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(4)

    for (const file of files) {
      const src = readFileSync(join(dir, file), 'utf8')
      if (!/\bcalendarFeeds\b/.test(src)) continue
      // Either it hands back a DTO, or it hands back nothing feed-shaped.
      const onlyConfirms = /return \{ ok: true \}/.test(src)
      expect(src.includes('toFeedDto') || onlyConfirms, file).toBe(true)
    }
  })
})

describe('the household response hands the ICS token to admins only', () => {
  // The attack: /feeds/<token>.ics has no session gate at all — the token is
  // the whole authentication — and every unlocked session used to be handed it.
  it('withholds it from non-admins, along with every other household secret', () => {
    const dto = toHouseholdDto(household(), { isAdmin: false })
    expect(dto).not.toHaveProperty('icsToken')
    const json = JSON.stringify(dto)
    expect(json).not.toContain(ICS_TOKEN)
    expect(json).not.toContain('household-password-hash')
    expect(json).not.toContain('ghp_supersecret')
    expect(json).not.toContain('vapid-private-key')
    // …but the settings screen still gets what it renders.
    expect(dto.name).toBe('Betts')
    expect(dto.timezone).toBe('America/Boise')
    expect(dto.locationName).toBe('Boise')
  })

  it('gives it to admins, who can also rotate it', () => {
    expect(toHouseholdDto(household(), { isAdmin: true }).icsToken).toBe(ICS_TOKEN)

    const next = rotateIcsToken(db, householdId)
    expect(next).not.toBe(ICS_TOKEN)
    expect(next.length).toBeGreaterThanOrEqual(32)
    // A leaked link is now dead: the .ics route compares against this column.
    expect(household().icsToken).toBe(next)
  })
})

describe('the public bootstrap withholds the family roster', () => {
  // The attack: GET /api/bootstrap needs no session (it renders the lock
  // screen) and boards do get exposed to the internet. It used to answer any
  // stranger with every member's name, avatar and role.
  it('gives a locked caller no roster and no household internals', () => {
    const payload = buildBootstrap(db, household(), null)
    expect(payload).not.toHaveProperty('profiles')
    expect(payload).not.toHaveProperty('activeProfileId')
    expect(payload).not.toHaveProperty('timezone')
    expect(payload).not.toHaveProperty('hasLocation')
    const json = JSON.stringify(payload)
    expect(json).not.toContain('Dad')
    expect(json).not.toContain('Kid')
    expect(json).not.toContain('household-password-hash')
    expect(json).not.toContain(ICS_TOKEN)
  })

  it('still gives the lock screen what it paints', () => {
    const payload = buildBootstrap(db, household(), null)
    expect(payload).toMatchObject({
      needsSetup: false,
      unlocked: false,
      householdName: 'Betts',
      needsPasswordReset: false,
    })
    // Locale and font live in settings; without them the lock screen comes up
    // in the wrong language.
    expect(payload).toHaveProperty('settings.locale')
  })

  it('adds the roster once the request carries an unlocked session', () => {
    archiveProfile(db, kid)
    const payload = buildBootstrap(db, household(), {
      unlocked: true, householdId, profileId: dad, role: 'admin',
    })
    expect(payload).toMatchObject({ unlocked: true, activeProfileId: dad, timezone: 'America/Boise', hasLocation: true })
    expect('profiles' in payload && payload.profiles.map(p => p.name)).toEqual(['Dad'])
    // Even here, only the columns the picker draws.
    expect('profiles' in payload && Object.keys(payload.profiles[0]!).sort())
      .toEqual(['avatarPath', 'color', 'id', 'name', 'role'])
  })

  it('reports setup before there is a household', () => {
    expect(buildBootstrap(db, null, null)).toEqual({ needsSetup: true })
  })
})
