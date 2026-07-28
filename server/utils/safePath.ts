import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Resolve `rel` underneath `root`, or return null when it escapes.
 *
 * The obvious `join(root, rel).startsWith(root)` reads as containment but is
 * not: it also admits any SIBLING directory whose name merely begins with the
 * root's. `join('/data/uploads', '../uploads-evil/x')` normalises to
 * `/data/uploads-evil/x`, which passes the prefix test — so a request path is
 * one `mkdir` away from reading files the route was never meant to serve.
 *
 * Asking `path.relative` instead answers the question actually being posed:
 * "to get from root to this file, do I have to walk out of root?" The `sep`
 * comparison matters too — a plain `startsWith('..')` would also reject a
 * legitimate entry named `..holiday-photos`.
 *
 * `resolve` (not `join`) so that an absolute `rel` such as `/etc/passwd` is
 * treated as the escape it is rather than being concatenated.
 */
export function resolveWithin(root: string, rel: string): string | null {
  const full = resolve(root, rel)
  const inside = relative(root, full)
  // '' means the root directory itself: never a file to serve.
  if (inside === '') return null
  if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) return null
  return full
}
