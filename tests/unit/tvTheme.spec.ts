import { describe, expect, it } from 'vitest'
import { isDaylight, sunTimes } from '../../server/services/tv/solar'
import { resolveTvTheme } from '../../server/services/tv/theme'

// Boise, ID — the household this was built for.
const BOISE = { lat: 43.615, lon: -116.2023, zone: 'America/Boise' }

function inBoise(iso: string) {
  // Explicit offsets so these assertions don't depend on the runner's zone.
  return new Date(iso)
}

describe('sunTimes', () => {
  it('matches published Boise times at the summer solstice', () => {
    const t = sunTimes(BOISE.lat, BOISE.lon, new Date('2026-06-21T12:00:00Z'))
    expect(t.kind).toBe('normal')
    if (t.kind !== 'normal') return
    const fmt = (d: Date) => d.toLocaleTimeString('en-US', { timeZone: BOISE.zone, hour12: false })
    // Published: ~05:59 / ~21:28 MDT. The simplified formula runs a few
    // minutes late; well inside what a theme switch cares about.
    expect(fmt(t.sunrise)).toMatch(/^0[56]:/)
    expect(fmt(t.sunset)).toMatch(/^21:/)
  })

  it('matches published Boise times at the winter solstice', () => {
    const t = sunTimes(BOISE.lat, BOISE.lon, new Date('2026-12-21T12:00:00Z'))
    expect(t.kind).toBe('normal')
    if (t.kind !== 'normal') return
    const fmt = (d: Date) => d.toLocaleTimeString('en-US', { timeZone: BOISE.zone, hour12: false })
    expect(fmt(t.sunrise)).toMatch(/^08:/)
    expect(fmt(t.sunset)).toMatch(/^17:/)
  })

  it('gives a roughly 12-hour day at the equator', () => {
    const t = sunTimes(0, 0, new Date('2026-03-20T12:00:00Z'))
    expect(t.kind).toBe('normal')
    if (t.kind !== 'normal') return
    const hours = (t.sunset.getTime() - t.sunrise.getTime()) / 3_600_000
    expect(hours).toBeGreaterThan(11.8)
    expect(hours).toBeLessThan(12.3)
  })

  it('reports polar day and polar night above the arctic circle', () => {
    expect(sunTimes(69.65, 18.96, new Date('2026-06-21T12:00:00Z')).kind).toBe('polar-day')
    expect(sunTimes(69.65, 18.96, new Date('2026-12-21T12:00:00Z')).kind).toBe('polar-night')
  })

  it('sunrise always precedes sunset', () => {
    for (const month of ['01', '04', '07', '10']) {
      const t = sunTimes(BOISE.lat, BOISE.lon, new Date(`2026-${month}-15T12:00:00Z`))
      if (t.kind === 'normal') expect(t.sunrise.getTime()).toBeLessThan(t.sunset.getTime())
    }
  })
})

describe('isDaylight', () => {
  it('is true at local noon and false at local midnight', () => {
    expect(isDaylight(BOISE.lat, BOISE.lon, inBoise('2026-07-23T19:00:00Z'))).toBe(true) // 13:00 MDT
    expect(isDaylight(BOISE.lat, BOISE.lon, inBoise('2026-07-23T08:00:00Z'))).toBe(false) // 02:00 MDT
  })
})

describe('resolveTvTheme', () => {
  const located = { timezone: BOISE.zone, latitude: BOISE.lat, longitude: BOISE.lon }

  it('is light during the day and dark at night on auto', () => {
    expect(resolveTvTheme({ ...located, preference: 'auto' }, inBoise('2026-07-23T19:00:00Z')).theme).toBe('light')
    expect(resolveTvTheme({ ...located, preference: 'auto' }, inBoise('2026-07-23T08:00:00Z')).theme).toBe('dark')
  })

  it('reports solar as the source when a location is set', () => {
    expect(resolveTvTheme({ ...located, preference: 'auto' }, new Date()).source).toBe('solar')
  })

  it('honours a forced preference regardless of time', () => {
    const night = inBoise('2026-07-23T08:00:00Z')
    expect(resolveTvTheme({ ...located, preference: 'light' }, night)).toMatchObject({ theme: 'light', source: 'forced' })
    const day = inBoise('2026-07-23T19:00:00Z')
    expect(resolveTvTheme({ ...located, preference: 'dark' }, day)).toMatchObject({ theme: 'dark', source: 'forced' })
  })

  it('defaults to auto when the household predates the setting', () => {
    expect(resolveTvTheme({ ...located }, inBoise('2026-07-23T19:00:00Z')).source).toBe('solar')
  })

  it('falls back to a wall-clock window with no location', () => {
    const noLocation = { timezone: BOISE.zone, latitude: null, longitude: null, preference: 'auto' as const }
    // 13:00 MDT → inside 07:00-19:00
    expect(resolveTvTheme(noLocation, inBoise('2026-07-23T19:00:00Z'))).toMatchObject({ theme: 'light', source: 'clock' })
    // 02:00 MDT → outside
    expect(resolveTvTheme(noLocation, inBoise('2026-07-23T08:00:00Z'))).toMatchObject({ theme: 'dark', source: 'clock' })
  })

  it('always schedules the next change in the future', () => {
    const cases: Array<{ preference: 'auto' | 'light' | 'dark', at: string, located: boolean }> = [
      { preference: 'auto', at: '2026-07-23T19:00:00Z', located: true },
      { preference: 'auto', at: '2026-07-23T08:00:00Z', located: true },
      { preference: 'auto', at: '2026-07-24T04:30:00Z', located: true }, // just after sunset
      { preference: 'light', at: '2026-07-23T19:00:00Z', located: true },
      { preference: 'auto', at: '2026-07-23T19:00:00Z', located: false },
      { preference: 'auto', at: '2026-07-23T08:00:00Z', located: false },
    ]
    for (const c of cases) {
      const now = new Date(c.at)
      const input = c.located
        ? { ...located, preference: c.preference }
        : { timezone: BOISE.zone, latitude: null, longitude: null, preference: c.preference }
      const result = resolveTvTheme(input, now)
      expect(result.nextChangeAt, `${c.preference} @ ${c.at} located=${c.located}`)
        .toBeGreaterThan(now.getTime())
    }
  })

  it('holds one theme all day inside the arctic circle', () => {
    const tromso = { timezone: 'Europe/Oslo', latitude: 69.65, longitude: 18.96, preference: 'auto' as const }
    expect(resolveTvTheme(tromso, new Date('2026-06-21T02:00:00Z')).theme).toBe('light')
    expect(resolveTvTheme(tromso, new Date('2026-12-21T12:00:00Z')).theme).toBe('dark')
  })
})
