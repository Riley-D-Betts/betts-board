import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import { resolveWithin } from '../../server/utils/safePath'

/**
 * The escape the old `full.startsWith(root)` guard allowed: not `..` climbing
 * out (normalize handles that), but a SIBLING whose name merely begins with
 * the root's. `/data/uploads` + `../uploads-evil/x` → `/data/uploads-evil/x`,
 * which shares the prefix and passed. Nothing was exploitable while no such
 * directory existed — the fix is that it stays that way after someone runs
 * mkdir. /fonts/** is not even session-gated, which is why this matters.
 */

const root = mkdtempSync(join(tmpdir(), 'betts-safepath-'))
const uploads = join(root, 'uploads')
const evil = join(root, 'uploads-evil')
mkdirSync(uploads, { recursive: true })
mkdirSync(evil, { recursive: true })
writeFileSync(join(evil, 'secret.txt'), 'not yours')
writeFileSync(join(uploads, 'photo.jpg'), 'ok')
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('resolveWithin', () => {
  it('rejects a sibling directory that shares the root’s prefix', () => {
    // The old guard, exactly: join() normalises the `..` away and the result
    // still carries the root as a string prefix, so the check passed.
    const escaped = join(uploads, '../uploads-evil/secret.txt')
    expect(escaped.startsWith(uploads)).toBe(true)
    expect(readFileSync(escaped, 'utf8')).toBe('not yours')

    expect(resolveWithin(uploads, '../uploads-evil/secret.txt')).toBeNull()
  })

  it.each([
    ['climbing out', '../../etc/passwd'],
    ['climbing out and back', 'photos/../../uploads-evil/secret.txt'],
    ['an absolute path', '/etc/passwd'],
    ['the root itself', ''],
    ['the root itself, spelled oddly', 'photos/..'],
    ['bare dot-dot', '..'],
  ])('rejects %s', (_label, rel) => {
    expect(resolveWithin(uploads, rel)).toBeNull()
  })

  it('still serves ordinary files, including names that only look like an escape', () => {
    expect(resolveWithin(uploads, 'photo.jpg')).toBe(join(uploads, 'photo.jpg'))
    expect(resolveWithin(uploads, 'photos/thumbs/a.jpg')).toBe(join(uploads, 'photos/thumbs/a.jpg'))
    // A real directory may legitimately start with dots; `startsWith('..')`
    // alone would have refused to serve it.
    expect(resolveWithin(uploads, '..holiday/a.jpg')).toBe(join(uploads, '..holiday/a.jpg'))
    expect(resolveWithin(join(root, 'fonts'), 'inter/400.woff2'))
      .toBe(join(root, 'fonts/inter/400.woff2'))
  })
})
