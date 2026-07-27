import { describe, expect, it } from 'vitest'
import { redactCredentials, sanitizeErrorList, sanitizeUpstreamMessage } from '../../server/services/finance/redact'

const ACCESS = 'https://5a7d3e1f9b:c4e8a2d6f0@bridge.simplefin.org/simplefin'

describe('redactCredentials', () => {
  it('redacts a SimpleFIN access URL', () => {
    expect(redactCredentials(ACCESS)).toBe('https://***:***@bridge.simplefin.org/simplefin')
  })

  it('redacts it embedded mid-sentence, which is how it reaches lastError', () => {
    const message = `fetch failed for ${ACCESS} after 3 retries`
    const out = redactCredentials(message)
    expect(out).not.toContain('c4e8a2d6f0')
    expect(out).not.toContain('5a7d3e1f9b')
    expect(out).toContain('after 3 retries')
  })

  it('redacts every occurrence, not just the first', () => {
    const out = redactCredentials(`${ACCESS} then ${ACCESS}`)
    expect(out.match(/\*\*\*:\*\*\*@/g)).toHaveLength(2)
    expect(out).not.toContain('c4e8a2d6f0')
  })

  it('handles a userinfo with no password', () => {
    expect(redactCredentials('https://tokenonly@bridge.simplefin.org/x'))
      .toBe('https://***:***@bridge.simplefin.org/x')
  })

  it('does not over-redact a URL with an @ in the path', () => {
    const url = 'https://bridge.simplefin.org/users/me@example.com/accounts'
    expect(redactCredentials(url)).toBe(url)
  })

  it('leaves an ordinary sentence alone', () => {
    expect(redactCredentials('Chase needs re-authentication')).toBe('Chase needs re-authentication')
  })
})

describe('sanitizeUpstreamMessage', () => {
  it('strips control characters that would wreck a log line', () => {
    expect(sanitizeUpstreamMessage('bank\u0000said\u001bno\u007f')).toBe('bank said no')
  })

  it('collapses whitespace and trims', () => {
    expect(sanitizeUpstreamMessage('  too   many \n spaces  ')).toBe('too many spaces')
  })

  it('caps the length so one error cannot wreck a phone layout', () => {
    const out = sanitizeUpstreamMessage('x'.repeat(5000))
    expect(out).toHaveLength(300)
    expect(out.endsWith('…')).toBe(true)
  })

  it('redacts before capping, so a truncated URL cannot leak', () => {
    const out = sanitizeUpstreamMessage(`${ACCESS} ${'x'.repeat(5000)}`)
    expect(out).not.toContain('c4e8a2d6f0')
  })
})

describe('sanitizeErrorList', () => {
  it('caps the number of entries', () => {
    expect(sanitizeErrorList(Array.from({ length: 40 }, (_, i) => `e${i}`))).toHaveLength(10)
  })

  it('ignores non-arrays and non-strings', () => {
    expect(sanitizeErrorList(undefined)).toEqual([])
    expect(sanitizeErrorList('nope')).toEqual([])
    expect(sanitizeErrorList([1, null, { a: 1 }, 'real'])).toEqual(['real'])
  })

  it('drops entries that sanitise to nothing', () => {
    expect(sanitizeErrorList(['\u0000\u0001', 'real'])).toEqual(['real'])
  })
})
