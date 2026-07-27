/* eslint-disable @typescript-eslint/no-explicit-any --
   these tests drill assertions into a generated OpenAPI document whose exact
   shape is the thing under test; a full OpenAPI type would just restate it. */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EXCLUDED_ROUTES, routeRegistry, TAGS } from '../../server/services/apiDocs/registry'
import { buildOpenApiSpec, conversionFallbacks } from '../../server/services/apiDocs/spec'

// THE DRIFT GUARD: diffs the apiDocs registry against the real route files in
// both directions. If this fails you added/removed/renamed a route without
// updating server/services/apiDocs/registry.ts.

const serverDir = fileURLToPath(new URL('../../server', import.meta.url))
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

/** Maps a Nitro route filename to its (method, OpenAPI path) per convention:
 *  index.get.ts → GET on the folder, [id].patch.ts → {id}, [...path] → {path},
 *  a name without a method suffix handles every method (we default to get). */
function routeFromFile(baseDir: string, prefix: string, file: string): { method: string, path: string } {
  const rel = file.slice(baseDir.length).replace(/^\//, '').slice(0, -'.ts'.length)
  const segments = rel.split('/')
  const last = segments.pop()!
  const dotParts = last.split('.')

  let method = 'get'
  let name = last
  if (dotParts.length > 1 && HTTP_METHODS.has(dotParts[dotParts.length - 1]!)) {
    method = dotParts.pop()!
    name = dotParts.join('.')
  }
  if (name !== 'index') segments.push(name)

  const path = [prefix, ...segments].join('/')
    .replace(/\[\.\.\.([^\]]+)\]/g, '{$1}')
    .replace(/\[([^\]]+)\]/g, '{$1}')
  return { method, path: path || '/' }
}

function discoverRoutes(): { method: string, path: string }[] {
  const apiDir = join(serverDir, 'api')
  const routesDir = join(serverDir, 'routes')
  return [
    ...walk(apiDir).map(f => routeFromFile(apiDir, '/api', f)),
    ...walk(routesDir).map(f => routeFromFile(routesDir, '', f)),
  ]
}

const key = (r: { method: string, path: string }) => `${r.method.toUpperCase()} ${r.path}`

describe('registry ↔ route files (anti-drift)', () => {
  const discovered = discoverRoutes()
  const discoveredKeys = new Set(discovered.map(key))
  const registryKeys = new Set(routeRegistry.map(key))
  const excludedKeys = new Set(EXCLUDED_ROUTES.map(key))

  it('documents every route file', () => {
    const undocumented = [...discoveredKeys].filter(k => !registryKeys.has(k) && !excludedKeys.has(k))
    expect(undocumented, `route files missing from server/services/apiDocs/registry.ts:\n  ${undocumented.join('\n  ')}`).toEqual([])
  })

  it('has no registry entry without a route file', () => {
    const stale = [...registryKeys].filter(k => !discoveredKeys.has(k))
    expect(stale, `registry entries with no matching route file:\n  ${stale.join('\n  ')}`).toEqual([])
  })

  it('has no duplicate entries', () => {
    expect(registryKeys.size).toBe(routeRegistry.length)
  })

  it('declares path params for every {param} in the path', () => {
    for (const route of routeRegistry) {
      const inPath = [...route.path.matchAll(/\{([^}]+)\}/g)].map(m => m[1])
      expect(route.pathParams ?? [], `${key(route)} pathParams`).toEqual(inPath)
    }
  })
})

describe('buildOpenApiSpec', () => {
  const spec = buildOpenApiSpec() as any
  const operations = Object.entries(spec.paths as Record<string, Record<string, any>>)
    .flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ path, method, op })))

  it('is a valid-shaped OpenAPI 3.1 document', () => {
    expect(spec.openapi).toMatch(/^3\.1\./)
    expect(spec.info.title).toBe('Betts Board API')
    expect(spec.info.version).toBe('1.0.0')
    expect(spec.servers).toEqual([{ url: '/' }])
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' })
    expect(Object.keys(spec.paths).length).toBeGreaterThanOrEqual(40)
  })

  it('declares every registry tag, and no operation uses an unknown one', () => {
    const declared = new Set((spec.tags as { name: string }[]).map(t => t.name))
    for (const name of Object.keys(TAGS)) expect(declared).toContain(name)
    for (const { path, method, op } of operations) {
      for (const tag of op.tags) {
        expect(declared, `${method} ${path} tag "${tag}"`).toContain(tag)
      }
    }
  })

  it('declares the right security scheme for every operation', () => {
    for (const route of routeRegistry) {
      const op = spec.paths[route.path]?.[route.method]
      expect(op, key(route)).toBeDefined()
      if (route.auth === 'public') {
        expect(op.security, `${key(route)} should opt out of auth`).toEqual([])
      }
      else if (route.auth === 'finance') {
        // Finance rejects bearer tokens outright, so documenting it as
        // bearerAuth would be a lie an API client would act on.
        expect(op.security, `${key(route)} should require cookieAuth`).toEqual([{ cookieAuth: [] }])
      }
      else {
        expect(op.security, `${key(route)} should require bearerAuth`).toEqual([{ bearerAuth: [] }])
      }
    }
    expect(spec.components.securitySchemes.cookieAuth).toMatchObject({ type: 'apiKey', in: 'cookie' })
  })

  it('documents at least one response per operation', () => {
    for (const { path, method, op } of operations) {
      const responses = Object.values(op.responses ?? {}) as { description?: string }[]
      expect(responses.length, `${method} ${path} responses`).toBeGreaterThan(0)
      for (const response of responses) expect(response.description, `${method} ${path}`).toBeTruthy()
    }
  })

  it('converts the big zod schemas into real object schemas (no fallback)', () => {
    const bodySchema = (path: string, method: string) =>
      spec.paths[path][method].requestBody.content['application/json'].schema

    const events = bodySchema('/api/events', 'post')
    expect(events.type).toBe('object')
    expect(events.properties.title).toMatchObject({ type: 'string' })
    expect(events.properties.timezone).toBeDefined()

    const chores = bodySchema('/api/chores', 'post')
    expect(chores.type).toBe('object')
    expect(chores.properties.assigneeProfileIds).toMatchObject({ type: 'array' })

    const recipes = bodySchema('/api/recipes', 'post')
    expect(recipes.type).toBe('object')
    expect(recipes.properties.ingredients.items.properties.raw).toMatchObject({ type: 'string' })

    expect(conversionFallbacks, `schemas that fell back to bare objects: ${conversionFallbacks.join(', ')}`).toEqual([])
  })

  it('renders query schemas as query parameters', () => {
    const params = spec.paths['/api/calendar'].get.parameters as any[]
    const start = params.find(p => p.name === 'start')
    expect(start).toMatchObject({ in: 'query', required: true })
    const profileIds = params.find(p => p.name === 'profileIds')
    expect(profileIds).toMatchObject({ in: 'query', required: false })
  })

  it('describes the photo upload as multipart/form-data', () => {
    const body = spec.paths['/api/photos'].post.requestBody
    expect(body.content['multipart/form-data']).toBeDefined()
  })
})
