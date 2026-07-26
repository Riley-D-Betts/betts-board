import { describe, expect, it } from 'vitest'
import { householdPatchSchema } from '#shared/schemas/household'
import { defaultHouseholdSettings } from '../../server/db/schema/household'
import { mergeSettings } from '../../server/services/household/settings'

describe('mergeSettings', () => {
  it('patching one nested key preserves its siblings', () => {
    const out = mergeSettings(defaultHouseholdSettings, { appearance: { font: 'lora' } })
    expect(out.appearance).toMatchObject({
      font: 'lora',
      accentLight: 'green', // untouched
      accentDark: 'green',
    })
  })

  it('preserves unrelated top-level objects', () => {
    const out = mergeSettings(defaultHouseholdSettings, { appearance: { accentDark: 'violet' } })
    expect(out.slideshow).toEqual(defaultHouseholdSettings.slideshow)
    expect(out.mealTimes).toEqual(defaultHouseholdSettings.mealTimes)
    expect(out.weekStartsOn).toBe(0)
  })

  it('merges a nested object that has no dedicated merge line (the old bug)', () => {
    // `tv` was added after the route was written. Under the previous
    // hand-written merge it would have replaced the whole object.
    const current = { ...defaultHouseholdSettings, tv: { theme: 'dark' as const } }
    const out = mergeSettings(current, { appearance: { font: 'inter' } })
    expect(out.tv).toEqual({ theme: 'dark' })
  })

  it('null replaces rather than merging, so a value can be cleared', () => {
    const current = { ...defaultHouseholdSettings, defaultCookProfileId: 'p1' }
    const out = mergeSettings(current, { defaultCookProfileId: null })
    expect(out.defaultCookProfileId).toBeNull()
  })

  it('undefined values in the patch are ignored', () => {
    const out = mergeSettings(defaultHouseholdSettings, { weekStartsOn: undefined })
    expect(out.weekStartsOn).toBe(0)
  })

  it('arrays replace wholesale instead of index-merging', () => {
    const current = { list: ['a', 'b', 'c'] }
    expect(mergeSettings(current, { list: ['x'] }).list).toEqual(['x'])
  })

  it('leaves the original object untouched', () => {
    const before = JSON.stringify(defaultHouseholdSettings)
    mergeSettings(defaultHouseholdSettings, { appearance: { font: 'nunito' } })
    expect(JSON.stringify(defaultHouseholdSettings)).toBe(before)
  })
})

describe('householdPatchSchema', () => {
  it('accepts a partial nested appearance patch', () => {
    const parsed = householdPatchSchema.parse({ settings: { appearance: { font: 'inter' } } })
    expect(parsed.settings?.appearance).toEqual({ font: 'inter' })
  })

  it('accepts the tv theme setting', () => {
    expect(householdPatchSchema.parse({ settings: { tv: { theme: 'auto' } } })
      .settings?.tv?.theme).toBe('auto')
  })

  it('rejects an unknown font', () => {
    expect(() => householdPatchSchema.parse({ settings: { appearance: { font: 'papyrus' } } }))
      .toThrow()
  })

  it('accepts a partial slideshow patch without requiring every key', () => {
    expect(() => householdPatchSchema.parse({ settings: { slideshow: { intervalSec: 20 } } }))
      .not.toThrow()
  })
})
