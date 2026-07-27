import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * dataDir() memoises in module scope, so the data dir is chosen once per spec
 * file — hence one temp dir here, with the key file removed between cases to
 * get a fresh key. Set before the first dataDir() call, which is lazy.
 */
const dir = mkdtempSync(join(tmpdir(), 'betts-crypto-'))
process.env.BETTS_DATA_DIR = dir
const keyPath = join(dir, '.finance-key')

const { decryptSecret, encryptSecret, resetKeyCache } = await import('~~/server/utils/crypto')

beforeEach(() => {
  rmSync(keyPath, { force: true })
  resetKeyCache()
})

afterAll(() => {
  delete process.env.BETTS_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

const ACCESS_URL = 'https://5a7d3e1f9b:c4e8a2d6f0@bridge.simplefin.org/simplefin'

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a SimpleFIN access URL', () => {
    expect(decryptSecret(encryptSecret(ACCESS_URL))).toBe(ACCESS_URL)
  })

  it('round-trips unicode, empty, and long values', () => {
    for (const value of ['', 'ünïcodé ✓ 日本語', 'a'.repeat(4096)]) {
      expect(decryptSecret(encryptSecret(value))).toBe(value)
    }
  })

  it('does not leave the credentials visible in the envelope', () => {
    const envelope = encryptSecret(ACCESS_URL)
    expect(envelope).not.toContain('c4e8a2d6f0')
    expect(envelope).not.toContain('simplefin')
  })

  it('uses a fresh IV, so the same input never encrypts identically', () => {
    expect(encryptSecret(ACCESS_URL)).not.toBe(encryptSecret(ACCESS_URL))
  })

  it('tags the envelope with a version so the algorithm can change later', () => {
    expect(encryptSecret(ACCESS_URL).split('.')[0]).toBe('v1')
  })
})

describe('decryptSecret failure modes', () => {
  it('returns null rather than throwing when the ciphertext is tampered with', () => {
    const parts = encryptSecret(ACCESS_URL).split('.')
    const data = Buffer.from(parts[3]!, 'base64')
    data[0] = data[0]! ^ 0xFF
    parts[3] = data.toString('base64')
    expect(decryptSecret(parts.join('.'))).toBeNull()
  })

  it('returns null when the GCM tag is tampered with', () => {
    const parts = encryptSecret(ACCESS_URL).split('.')
    const tag = Buffer.from(parts[2]!, 'base64')
    tag[0] = tag[0]! ^ 0xFF
    parts[2] = tag.toString('base64')
    expect(decryptSecret(parts.join('.'))).toBeNull()
  })

  it('returns null when the IV is swapped for another message’s', () => {
    const parts = encryptSecret(ACCESS_URL).split('.')
    parts[1] = encryptSecret('decoy').split('.')[1]!
    expect(decryptSecret(parts.join('.'))).toBeNull()
  })

  it.each([
    [null, 'null column'],
    [undefined, 'undefined'],
    ['', 'empty string'],
    ['not-an-envelope', 'plaintext left over from an earlier version'],
    ['v1.only.three', 'truncated column'],
    ['v2.aaa.bbb.ccc', 'envelope from a future version'],
    ['v1....', 'empty segments'],
  ])('returns null for %j (%s)', (input) => {
    expect(decryptSecret(input as string | null | undefined)).toBeNull()
  })

  it('returns null after the key is replaced, so callers say “reconnect”', () => {
    const envelope = encryptSecret(ACCESS_URL)
    writeFileSync(keyPath, Buffer.alloc(32, 7).toString('base64'))
    resetKeyCache()
    expect(decryptSecret(envelope)).toBeNull()
  })
})

describe('the key file', () => {
  it('is created on first use: 32 bytes, owner-only', () => {
    encryptSecret('x')
    expect(Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64')).toHaveLength(32)
    expect(statSync(keyPath).mode & 0o777).toBe(0o600)
  })

  it('is reused across calls, not regenerated per encryption', () => {
    const envelope = encryptSecret(ACCESS_URL)
    const written = readFileSync(keyPath, 'utf8')
    resetKeyCache()
    expect(decryptSecret(envelope)).toBe(ACCESS_URL)
    expect(readFileSync(keyPath, 'utf8')).toBe(written)
  })

  it('refuses to guess when the key file is the wrong length', () => {
    writeFileSync(keyPath, Buffer.alloc(16).toString('base64'))
    resetKeyCache()
    expect(() => encryptSecret('x')).toThrow(/32-byte key/)
  })
})
