import { z } from 'zod'

/**
 * THE font registry. Adding a font means adding one entry here (plus an
 * `@font-face` block in main.css for a bundled one) — the settings enum, the
 * picker UI, and the applied CSS stack all derive from this list.
 *
 * `stack` is applied by writing `--betts-font` onto <html>, so no per-font CSS
 * rule is needed and the stack can never drift from the label the user picked.
 */
export interface FontDef {
  value: string
  label: string
  stack: string
  /** system = no download, always available. bundled = woff2 shipped in the build. */
  kind: 'system' | 'bundled'
}

const SYSTEM_FALLBACK = 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif'

export const FONT_DEFS: readonly FontDef[] = [
  // System stacks — the original five. Values are unchanged so existing
  // households keep the font they already chose.
  { value: 'rounded', label: 'Rounded', kind: 'system', stack: SYSTEM_FALLBACK },
  { value: 'system', label: 'System', kind: 'system', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { value: 'serif', label: 'Serif', kind: 'system', stack: '"Iowan Old Style", "Palatino Linotype", Georgia, "Times New Roman", serif' },
  { value: 'mono', label: 'Mono', kind: 'system', stack: 'ui-monospace, "Cascadia Code", Consolas, "Courier New", monospace' },
  { value: 'playful', label: 'Playful', kind: 'system', stack: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive, sans-serif' },

  // Bundled webfonts — self-hosted woff2 under app/assets/fonts/, never fetched
  // from Google at runtime.
  { value: 'inter', label: 'Inter', kind: 'bundled', stack: `"Inter", ${SYSTEM_FALLBACK}` },
  { value: 'nunito', label: 'Nunito', kind: 'bundled', stack: `"Nunito", ${SYSTEM_FALLBACK}` },
  { value: 'poppins', label: 'Poppins', kind: 'bundled', stack: `"Poppins", ${SYSTEM_FALLBACK}` },
  { value: 'lexend', label: 'Lexend', kind: 'bundled', stack: `"Lexend", ${SYSTEM_FALLBACK}` },
  { value: 'fredoka', label: 'Fredoka', kind: 'bundled', stack: `"Fredoka", ${SYSTEM_FALLBACK}` },
  { value: 'atkinson', label: 'Atkinson', kind: 'bundled', stack: `"Atkinson Hyperlegible", ${SYSTEM_FALLBACK}` },
  { value: 'lora', label: 'Lora', kind: 'bundled', stack: '"Lora", Georgia, serif' },
  { value: 'jetbrains', label: 'JetBrains', kind: 'bundled', stack: '"JetBrains Mono", ui-monospace, Consolas, monospace' },
] as const

/** Sentinel for "use the household's downloaded Google Font". */
export const CUSTOM_FONT = 'custom'

const FONT_VALUES = FONT_DEFS.map(f => f.value) as [string, ...string[]]

export const zFontChoice = z.enum([...FONT_VALUES, CUSTOM_FONT] as [string, ...string[]])

/** Resolve a stored font choice to a CSS font stack. */
export function fontStack(value: string | undefined, customFamily?: string | null): string {
  if (value === CUSTOM_FONT && customFamily) {
    return `"${customFamily.replace(/"/g, '')}", ${SYSTEM_FALLBACK}`
  }
  return FONT_DEFS.find(f => f.value === value)?.stack ?? SYSTEM_FALLBACK
}

/** A Google Font family the household downloaded. Files live in the data volume. */
export const customFontSchema = z.object({
  family: z.string().min(1).max(60),
  slug: z.string().min(1).max(80),
  /** Content hash — cache-busts the stylesheet when a family is re-downloaded. */
  version: z.string().min(1).max(40),
})

export type CustomFont = z.infer<typeof customFontSchema>

/**
 * Google family names only: letters, digits, spaces. Rejects anything that
 * could alter the request URL's shape or escape into the generated CSS.
 */
export const googleFontNameSchema = z.string().trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/, 'Use a Google Font family name, e.g. "Roboto Slab"')
