import { hash } from '@node-rs/argon2'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb, setDb, type Db } from '../../server/db/client'
import { defaultHouseholdSettings, households } from '../../server/db/schema'
import { installNitroGlobals, sessionOf } from '../support/nitroGlobals'

// The lockout state is a file in the data volume; point that at a temp dir
// before anything resolves it.
process.env.BETTS_DATA_DIR = mkdtempSync(join(tmpdir(), 'betts-unlock-'))

installNitroGlobals()

const { unlockHousehold } = await import('../../server/services/auth/unlock')
const {
  UNLOCK_LOCKOUT_STEPS, UNLOCK_MAX_LOCKOUT_MS,
  clearUnlockFailures, recordUnlockFailure, unlockLockoutRemainingMs, unlockLockoutState,
} = await import('../../server/services/auth/unlockLockout')

const PASSWORD = 'correct horse battery staple'
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 }

let db: Db

/** A request as h3 sees it — socket peer plus whatever headers the client sent. */
function request(socketIp: string, forwardedFor?: string): H3Event {
  const headers: Record<string, string> = {}
  if (forwardedFor !== undefined) headers['x-forwarded-for'] = forwardedFor
  return {
    context: {},
    sessionData: {},
    node: {
      req: { headers, socket: { remoteAddress: socketIp } },
      // Retry-After is written here on the lockout path.
      res: { setHeader: () => {} },
    },
  } as unknown as H3Event
}

/** Returns the status code an attempt produced, or 200 on success. */
async function attempt(event: H3Event, password: string): Promise<number> {
  try {
    await unlockHousehold(event, password)
    return 200
  }
  catch (err) {
    return (err as { statusCode?: number }).statusCode ?? 0
  }
}

beforeAll(async () => {
  db = createDb(':memory:')
  migrate(db, { migrationsFolder: 'drizzle' })
  setDb(db)
  db.insert(households).values({
    name: 'Betts',
    passwordHash: await hash(PASSWORD, ARGON),
    timezone: 'America/Boise',
    icsToken: 'tok',
    settings: defaultHouseholdSettings,
  }).run()
})

beforeEach(() => {
  clearUnlockFailures()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('per-caller rate limit', () => {
  /**
   * The measured bypass: 30 wrong passwords with a rotating forged
   * X-Forwarded-For used to give 30x401 and zero 429s, because h3 reads the
   * first element of that client-written header and the bucket key was
   * therefore attacker-chosen.
   */
  it('a forged X-Forwarded-For does not buy extra guesses', async () => {
    const codes: number[] = []
    for (let i = 0; i < 30; i++) {
      codes.push(await attempt(request('198.51.100.5', `203.0.113.${i}`), 'wrong'))
    }

    expect(codes.filter(c => c === 401)).toHaveLength(5)
    expect(codes.filter(c => c === 429)).toHaveLength(25)
  })

  it('lets the family in from the same address once they type it right', async () => {
    const event = request('192.168.1.44')
    expect(await attempt(event, 'wrong')).toBe(401)
    expect(await attempt(event, PASSWORD)).toBe(200)
    expect(sessionOf(event)).toMatchObject({ user: { unlocked: true } })
  })
})

describe('household-wide lockout', () => {
  /**
   * The per-caller bucket is per key, so an attacker with many addresses just
   * brings more keys. This counter is what a distributed attack runs into.
   */
  it('locks every source out after enough failures from different addresses', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.now()

    for (let i = 0; i < 10; i++) {
      expect(await attempt(request(`203.0.113.${i}`), 'wrong')).toBe(401)
    }

    // A brand-new address with a fresh bucket, and even the RIGHT password:
    // still refused, or the lockout would be trivially side-stepped.
    expect(await attempt(request('203.0.113.200'), 'wrong')).toBe(429)
    expect(await attempt(request('203.0.113.201'), PASSWORD)).toBe(429)

    // ...and it lets go on its own, so the family is not locked out for long.
    vi.setSystemTime(start + 61_000)
    const event = request('192.168.1.50')
    expect(await attempt(event, PASSWORD)).toBe(200)
    expect(unlockLockoutState().failures).toBe(0)
  })

  it('escalates on repeat but never past the cap — a stranger must not brick the tablet', () => {
    const now = Date.now()
    const locks: number[] = []
    for (let i = 1; i <= 200; i++) {
      const state = recordUnlockFailure(now)
      locks.push(Math.max(0, state.lockedUntil - now))
    }

    expect(locks[8]).toBe(0) // 9 failures: no lock yet, families fumble passwords
    expect(locks[9]).toBe(60_000) // 10th
    expect(locks[19]).toBe(5 * 60_000) // 20th
    expect(locks[29]).toBe(UNLOCK_MAX_LOCKOUT_MS) // 30th
    expect(Math.max(...locks)).toBe(UNLOCK_MAX_LOCKOUT_MS)
    expect(UNLOCK_MAX_LOCKOUT_MS).toBeLessThanOrEqual(15 * 60_000)
    expect(UNLOCK_LOCKOUT_STEPS[0]!.ms).toBe(UNLOCK_MAX_LOCKOUT_MS)
  })

  it('a correct password clears the counter', async () => {
    for (let i = 0; i < 9; i++) recordUnlockFailure()
    expect(unlockLockoutState().failures).toBe(9)

    expect(await attempt(request('192.168.1.60'), PASSWORD)).toBe(200)
    expect(unlockLockoutState()).toEqual({ failures: 0, lockedUntil: 0 })
  })

  it('survives a restart — the counter is not reset by bouncing the container', async () => {
    for (let i = 0; i < 12; i++) recordUnlockFailure()
    expect(unlockLockoutRemainingMs()).toBeGreaterThan(0)

    // Fresh module graph = fresh process, reading the same data volume.
    vi.resetModules()
    const restarted = await import('../../server/services/auth/unlockLockout')
    expect(restarted.unlockLockoutState().failures).toBe(12)
    expect(restarted.unlockLockoutRemainingMs()).toBeGreaterThan(0)
  })
})
