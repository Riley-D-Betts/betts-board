import type { HouseholdSettings } from '#shared/schemas/household'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Recursively merges a partial settings patch into the stored settings.
 *
 * Replaces the old hand-written "one merge line per nested object" in the
 * PATCH route, where forgetting a line meant a partial patch silently wiped
 * that object's other keys.
 *
 * Arrays and `null` replace wholesale — `defaultCookProfileId: null` must still
 * clear the value rather than merge into it.
 */
export function mergeSettings<T extends Record<string, unknown>>(
  current: T,
  patch: Record<string, unknown> | undefined,
): T {
  if (!patch) return current
  const out: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const existing = out[key]
    out[key] = isPlainObject(value) && isPlainObject(existing)
      ? mergeSettings(existing, value)
      : value
  }
  return out as T
}

export type { HouseholdSettings }
