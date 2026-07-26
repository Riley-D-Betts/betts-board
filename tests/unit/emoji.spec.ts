import { describe, expect, it } from 'vitest'
import { zEmoji } from '#shared/schemas/common'
import { choreCreateSchema } from '#shared/schemas/chores'

describe('zEmoji', () => {
  // The old rule was z.string().max(8) — a UTF-16 *code unit* cap, which
  // silently rejected the most-used family emoji.
  it.each([
    ['🧹', 'simple'],
    ['⚽', 'BMP'],
    ['👩‍🍳', 'ZWJ sequence (5 units)'],
    ['🧑🏽‍🌾', 'skin tone + ZWJ (7 units)'],
    ['👨‍👩‍👧‍👦', 'family, 11 units — rejected by the old max(8)'],
    ['🏳️‍🌈', 'flag ZWJ'],
    ['🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'tag sequence, 14 units'],
    ['🇺🇸', 'regional indicator pair'],
    ['A', 'a plain letter is one grapheme'],
  ])('accepts %s (%s)', (value) => {
    expect(zEmoji.parse(value)).toBe(value)
  })

  it.each([
    ['', 'empty'],
    ['🧹🧺', 'two emoji'],
    ['ab', 'two letters'],
    ['🧹 ', 'emoji plus a space'],
    ['not an emoji at all', 'a sentence'],
  ])('rejects %j (%s)', (value) => {
    expect(() => zEmoji.parse(value)).toThrow()
  })

  it('rejects an absurdly long string before segmenting it', () => {
    expect(() => zEmoji.parse('🧹'.repeat(100))).toThrow()
  })
})

describe('chore emoji field', () => {
  it('accepts a typed family emoji on a chore', () => {
    const chore = choreCreateSchema.parse({
      title: 'Family movie night',
      emoji: '👨‍👩‍👧‍👦',
      points: 1,
      startDate: '2026-07-23',
      assigneeProfileIds: ['profile-1'],
    })
    expect(chore.emoji).toBe('👨‍👩‍👧‍👦')
  })

  it('still allows no emoji', () => {
    expect(choreCreateSchema.parse({
      title: 'Dishes',
      emoji: null,
      points: 1,
      startDate: '2026-07-23',
      assigneeProfileIds: ['profile-1'],
    }).emoji).toBeNull()
  })
})
