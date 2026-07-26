import { describe, expect, it } from 'vitest'
import { googleFontNameSchema } from '#shared/schemas/fonts'
import { assertFontUrl, generateCss, parseFontFaces, slugifyFamily } from '../../server/services/fonts/google'

const SAMPLE_CSS = `
/* cyrillic */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v20/abc.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v20/def.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+2000-206F;
}
`

describe('googleFontNameSchema', () => {
  it.each(['Roboto', 'Roboto Slab', 'Noto Sans JP', 'Inter'])('accepts %s', (name) => {
    expect(googleFontNameSchema.parse(name)).toBe(name)
  })

  // The name is interpolated into a URL and into generated CSS; anything that
  // could change the shape of either has to be refused up front.
  it.each([
    ['../../etc/passwd', 'path traversal'],
    ['Roboto&text=x', 'extra query parameter'],
    ['Roboto:wght@900', 'weight injection'],
    ["Roboto'; }", 'CSS escape'],
    ['Roboto\nInjected', 'newline'],
    ['<script>', 'markup'],
    ['', 'empty'],
    ['x'.repeat(80), 'too long'],
    ['https://evil.test/font', 'a URL instead of a name'],
  ])('rejects %j (%s)', (name) => {
    expect(() => googleFontNameSchema.parse(name)).toThrow()
  })
})

describe('assertFontUrl', () => {
  it('accepts an https fonts.gstatic.com URL', () => {
    expect(assertFontUrl('https://fonts.gstatic.com/s/inter/v20/abc.woff2').hostname)
      .toBe('fonts.gstatic.com')
  })

  it.each([
    ['http://fonts.gstatic.com/a.woff2', 'plain http'],
    ['https://fonts.gstatic.com.evil.test/a.woff2', 'suffix-matching lookalike'],
    ['https://evilfonts.gstatic.com.co/a.woff2', 'another lookalike'],
    ['https://evil.test/a.woff2', 'unrelated host'],
    ['file:///etc/passwd', 'file scheme'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['https://127.0.0.1/a.woff2', 'loopback'],
    ['not a url', 'garbage'],
  ])('rejects %s (%s)', (url) => {
    expect(() => assertFontUrl(url)).toThrow()
  })
})

describe('parseFontFaces', () => {
  it('extracts every face with its weight, style, and range', () => {
    const faces = parseFontFaces(SAMPLE_CSS)
    expect(faces).toHaveLength(2)
    expect(faces[0]).toMatchObject({ weight: '400', style: 'normal' })
    expect(faces[1]).toMatchObject({ weight: '700' })
    expect(faces[1]!.url).toBe('https://fonts.gstatic.com/s/inter/v20/def.woff2')
  })

  it('ignores blocks with no woff2 source', () => {
    expect(parseFontFaces('@font-face { font-family: X; src: local(X); }')).toEqual([])
  })

  it('returns nothing for empty input', () => {
    expect(parseFontFaces('')).toEqual([])
  })
})

describe('generateCss', () => {
  const faces = parseFontFaces(SAMPLE_CSS)
  const css = generateCss('Inter', 'inter', faces.map((face, i) => ({ file: `${i}.woff2`, face })))

  it('points at our own served paths, not Google', () => {
    expect(css).toContain('src: url(/fonts/inter/0.woff2)')
    expect(css).not.toContain('fonts.gstatic.com')
  })

  it('carries no @import or javascript: URLs through from the source', () => {
    const hostile = generateCss('Inter', 'inter', parseFontFaces(`
      @import url('https://evil.test/x.css');
      @font-face { font-family: 'Inter'; src: url(https://fonts.gstatic.com/a.woff2) format('woff2'); }
    `).map((face, i) => ({ file: `${i}.woff2`, face })))
    expect(hostile).not.toContain('@import')
    expect(hostile).not.toContain('evil.test')
    expect(hostile).not.toContain('javascript:')
  })

  it('declares the variable the font registry resolves against', () => {
    expect(css).toContain("--betts-custom-font: 'Inter'")
  })

  it('preserves weight and unicode-range', () => {
    expect(css).toContain('font-weight: 700')
    expect(css).toContain('unicode-range: U+0000-00FF')
  })
})

describe('slugifyFamily', () => {
  it.each([
    ['Roboto Slab', 'roboto-slab'],
    ['Inter', 'inter'],
    ['Noto Sans JP', 'noto-sans-jp'],
  ])('%s -> %s', (input, expected) => {
    expect(slugifyFamily(input)).toBe(expected)
  })

  it('produces a filesystem-safe slug with no separators', () => {
    expect(slugifyFamily('a/../b')).not.toContain('/')
    expect(slugifyFamily('a/../b')).not.toContain('.')
  })
})
