import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { routeRegistry } from '../../server/services/apiDocs/registry'

/**
 * Static drift guards for the finance boundary, in the same spirit as the
 * OpenAPI coverage test: the danger isn't the code written today, it's the
 * route somebody adds in six months without the guard call. A silent hole is
 * exactly the failure mode worth spending a cheap test on.
 */

const serverDir = fileURLToPath(new URL('../../server', import.meta.url))
const financeApiDir = join(serverDir, 'api', 'finance')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

/**
 * The only finance routes that may run without a live finance session. They
 * are what renders the lock screen, and each still requires an unlocked
 * household session. Kept in sync with server/middleware/finance.ts.
 */
const OPEN_ROUTES = new Set([
  'session.get.ts',
  'unlock.post.ts',
  'lock.post.ts',
  'pin.post.ts',
])

const files = walk(financeApiDir)

describe('every finance route is gated', () => {
  it('found the finance routes at all', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it.each(files.map(f => [f.slice(financeApiDir.length + 1), f]))(
    '%s calls requireFinanceAccess or requireFinanceOwner',
    (relative, file) => {
      const source = readFileSync(file, 'utf8')
      const basename = relative.split('/').pop()!
      if (OPEN_ROUTES.has(basename) && !relative.includes('/')) {
        expect(source).toMatch(/requireProfile|requireUnlocked/)
        return
      }
      expect(source).toMatch(/requireFinance(Access|Owner)\(event\)/)
    },
  )

  it('never uses requireAdmin — household admin is not a finance boundary', () => {
    // Anyone at the tablet can become admin: POST /api/auth/profile takes no
    // credential. requireAdmin guards against unbound API keys and accidents,
    // not against a person at the device.
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/requireAdmin/)
    }
  })

  it('keeps the middleware allowlist and this test in agreement', () => {
    const middleware = readFileSync(join(serverDir, 'middleware', 'finance.ts'), 'utf8')
    for (const route of OPEN_ROUTES) {
      const path = `/api/finance/${route.replace(/\.(get|post|patch|delete)\.ts$/, '')}`
      expect(middleware, `${path} should be in the middleware allowlist`).toContain(path)
    }
    // And nothing else is: count the allowlist entries.
    const listed = middleware.match(/'\/api\/finance\/[^']+'/g) ?? []
    expect(listed).toHaveLength(OPEN_ROUTES.size)
  })
})

describe('the OpenAPI registry tells the truth about finance', () => {
  const financeRoutes = routeRegistry.filter(r => r.path.startsWith('/api/finance/'))

  it('documents every finance route', () => {
    expect(financeRoutes.length).toBe(files.length)
  })

  it('never claims a gated finance route accepts a bearer key', () => {
    for (const route of financeRoutes) {
      const isOpen = ['/api/finance/session', '/api/finance/unlock', '/api/finance/lock', '/api/finance/pin']
        .includes(route.path)
      if (isOpen) continue
      expect(route.auth, `${route.method.toUpperCase()} ${route.path}`).toBe('finance')
    }
  })
})

describe('finance data cannot reach the wall display or the ICS feed', () => {
  const readIfExists = (...segments: string[]) => {
    try {
      return readFileSync(join(serverDir, ...segments), 'utf8')
    }
    catch {
      return ''
    }
  }

  it.each([
    ['bootstrap (public!)', readIfExists('api', 'bootstrap.get.ts')],
    ['the slideshow manifest', readIfExists('api', 'slideshow.get.ts')],
    ['the ICS export route', readIfExists('routes', 'feeds', '[token].ics.get.ts')],
  ])('%s never touches a finance table', (_label, source) => {
    expect(source).not.toMatch(/finance/i)
  })

  it('the calendar aggregate never touches a finance table', () => {
    for (const file of walk(join(serverDir, 'services', 'calendar'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/financeBills|financeTransactions|financeAccounts/)
    }
    for (const file of walk(join(serverDir, 'api', 'calendar'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/finance/i)
    }
  })

  it('the ICS builder never touches a finance table', () => {
    for (const file of walk(join(serverDir, 'services', 'ics'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/finance/i)
    }
  })

  it('bills are expanded through the calendar service, not written to events', () => {
    const bills = readFileSync(join(serverDir, 'services', 'finance', 'bills.ts'), 'utf8')
    expect(bills).toContain('expandDateRule')
    // Writing a bill into the events table would publish it to the ICS feed
    // and the TV agenda, which is the thing this whole design avoids.
    expect(bills).not.toMatch(/insert\(events\)/)
    expect(bills).not.toMatch(/from '.*schema\/events'/)
  })

  it('rrule is still imported in exactly one place', () => {
    const offenders = walk(join(serverDir, 'services'))
      .filter(f => /from 'rrule'/.test(readFileSync(f, 'utf8')))
      .map(f => f.slice(serverDir.length + 1))
    expect(offenders).toEqual(['services/calendar/recurrence.ts'])
  })
})
