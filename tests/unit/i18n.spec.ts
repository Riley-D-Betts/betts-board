import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOCALE_DEFS, DEFAULT_LOCALE, languageTag, localeDef } from '#shared/schemas/locales'

/**
 * The guard that keeps translations honest.
 *
 * A missing key doesn't crash — vue-i18n falls back to printing the key path,
 * so `settings.language.title` appears on screen where a word should be. That
 * is invisible in review and only ever found by someone using the app in a
 * language none of us reads. So it is checked mechanically, per key, here.
 *
 * Placeholders matter just as much: `{n}` dropped from a translated string
 * silently deletes the number from the sentence, and a plural form with the
 * wrong number of `|` branches throws at render time in the one language that
 * has it wrong.
 */

const localesDir = fileURLToPath(new URL('../../i18n/locales', import.meta.url))

type Tree = Record<string, unknown>

function loadLocale(code: string): Record<string, Tree> {
  const dir = join(localesDir, code)
  const out: Record<string, Tree> = {}
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    out[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  }
  return out
}

/** Every leaf as `feature.a.b` → the string, so diffs name the exact key. */
function flatten(tree: Record<string, Tree>): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (node: unknown, path: string) => {
    if (typeof node === 'string') return void out.set(path, node)
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k)
    }
  }
  walk(tree, '')
  return out
}

/** `{name}`, `{n}` — named placeholders vue-i18n will substitute. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]!).sort()
}

/** Pluralisation branches: "1 thing | {n} things" has two. */
function branchCount(value: string): number {
  return value.split('|').length
}

const english = flatten(loadLocale(DEFAULT_LOCALE))
const translated = LOCALE_DEFS.filter(l => l.code !== DEFAULT_LOCALE)

describe('the locale registry', () => {
  it('lists English first, as the fallback', () => {
    expect(LOCALE_DEFS[0]!.code).toBe(DEFAULT_LOCALE)
  })

  it('gives every language a region-qualified BCP 47 tag', () => {
    for (const l of LOCALE_DEFS) expect(l.language).toMatch(/^[a-z]{2}-[A-Z]{2}$/)
  })

  it('falls back to English for a code it does not ship', () => {
    expect(localeDef('de').code).toBe(DEFAULT_LOCALE)
    expect(languageTag(undefined)).toBe('en-US')
    expect(languageTag('fr')).toBe('fr-FR')
  })

  it('has a folder and an entrypoint for every registered language', () => {
    for (const l of LOCALE_DEFS) {
      expect(existsSync(join(localesDir, l.code)), `${l.code}/ missing`).toBe(true)
      expect(existsSync(join(localesDir, l.file)), `${l.file} missing`).toBe(true)
    }
  })

  it('names each language in that language, so it can be found', () => {
    expect(LOCALE_DEFS.map(l => l.name)).toEqual(['English', 'Español', 'Français'])
  })
})

/**
 * The other half of the guard, and the one that catches an extraction pass
 * that half-finished: a component saying $t('calendar.editor.title') for a key
 * nobody ever wrote. vue-i18n renders the key path instead of throwing, so the
 * screen quietly shows "calendar.editor.title" where a heading should be.
 *
 * Only literal keys are checkable — a computed key like $t(`x.${kind}`) is
 * skipped, which is itself a reason to prefer literals.
 */
describe('keys referenced in the app', () => {
  const appDir = fileURLToPath(new URL('../../app', import.meta.url))

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return sourceFiles(full)
      return /\.(vue|ts)$/.test(entry.name) ? [full] : []
    })
  }

  const referenced = new Map<string, string>()
  for (const file of sourceFiles(appDir)) {
    const source = readFileSync(file, 'utf8')
    for (const m of source.matchAll(/(?:\$t|\bt)\(\s*'([a-zA-Z][\w.]*)'/g)) {
      referenced.set(m[1]!, file.slice(appDir.length + 1))
    }
  }

  it('finds keys to check (the regex still matches this codebase)', () => {
    expect(referenced.size).toBeGreaterThan(200)
  })

  it('resolves every literal key against the English messages', () => {
    const missing = [...referenced.entries()]
      .filter(([key]) => !english.has(key))
      // A parent path used with a count, e.g. $t('a.b') where a.b is a plural
      // string, still resolves; a path that is a whole OBJECT does not.
      .map(([key, file]) => `${key}  (${file})`)
    expect(missing).toEqual([])
  })
})

describe.each(translated)('$name ($code)', ({ code }) => {
  const other = flatten(loadLocale(code))

  it('translates every English key', () => {
    const missing = [...english.keys()].filter(k => !other.has(k))
    expect(missing).toEqual([])
  })

  it('invents no key English does not have', () => {
    const extra = [...other.keys()].filter(k => !english.has(k))
    expect(extra).toEqual([])
  })

  it('keeps every placeholder', () => {
    const broken: string[] = []
    for (const [key, en] of english) {
      const mine = other.get(key)
      if (mine === undefined) continue
      const a = placeholders(en).join(',')
      const b = placeholders(mine).join(',')
      if (a !== b) broken.push(`${key}: expected {${a}}, got {${b}}`)
    }
    expect(broken).toEqual([])
  })

  it('keeps the same number of plural branches', () => {
    const broken: string[] = []
    for (const [key, en] of english) {
      const mine = other.get(key)
      if (mine === undefined) continue
      if (branchCount(en) !== branchCount(mine)) {
        broken.push(`${key}: expected ${branchCount(en)} branches, got ${branchCount(mine)}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('leaves nothing blank', () => {
    const blank = [...other.entries()].filter(([, v]) => !v.trim()).map(([k]) => k)
    expect(blank).toEqual([])
  })

  /**
   * Not a strict rule — "PIN", "SimpleFIN", "OFX" and "Wi-Fi" are the same
   * word everywhere, and a short label like "Total" is legitimately identical
   * in Spanish. This catches the failure mode where a whole file was copied
   * and never translated.
   */
  it('is not simply a copy of the English file', () => {
    const identical = [...other.entries()].filter(([k, v]) => english.get(k) === v)
    expect(identical.length / other.size).toBeLessThan(0.25)
  })
})
