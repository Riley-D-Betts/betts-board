import type { ZodType } from 'zod'
import { z } from 'zod'
import type { AuthLevel, RouteDoc } from './registry'
import { routeRegistry, TAGS } from './registry'

export const VERSION = '1.0.0'

// OpenAPI 3.1 uses JSON Schema draft 2020-12 natively, which is exactly what
// zod v4's toJSONSchema emits by default — so schemas convert losslessly.
// .refine() checks aren't representable in JSON Schema; zod drops them from
// the output (the summary/description carries those rules in prose).

const AUTH_NOTES: Record<AuthLevel, string> = {
  public: 'Auth: none — public endpoint.',
  unlocked: 'Auth: any unlocked session or API key (no acting profile needed).',
  profile: 'Auth: needs an acting profile — a profile-bound API key, or a session with a profile selected. Unbound keys get `403 No acting profile`.',
  admin: 'Auth: admin — the acting profile (or the key\'s bound profile) must have the admin role.',
}

const INFO_DESCRIPTION = `Everything the board can do, an API client can do too — every screen in the
app talks to these same endpoints.

## Authentication

Create a key in **Settings → API access** (admin only). The token (\`bb_…\`) is
shown exactly once; only its hash is stored. Send it on every request:

\`\`\`
Authorization: Bearer bb_your_token_here
\`\`\`

- A key **bound to a profile** acts as that family member: its requests can use
  every route that member could, and actions (completing chores, adding notes)
  are attributed to them. A key bound to an **admin** profile can also manage
  settings-level routes (feeds, profiles, API keys).
- An **unbound** key is read-mostly: it can only call routes that don't need an
  acting profile (auth level *unlocked*). Routes marked *profile* return
  \`403 No acting profile\`.
- Revoked keys, and keys bound to an archived profile, get \`401 Invalid API key\`.

## Errors

Standard HTTP status codes with a human-readable \`statusMessage\`:
\`400\` invalid input (zod validation), \`401\` missing/invalid auth, \`403\` not
allowed for this key/role, \`404\` not found, \`409\` setup required.

## Conventions

- IDs are UUID strings.
- Instants (timed events) are **epoch milliseconds**; calendar dates (all-day
  events, chore due dates, meal-plan dates) are **\`YYYY-MM-DD\` strings** in the
  household's local calendar — never timezone-converted.
- Date-range windows are half-open: \`start\` inclusive, \`end\` exclusive.
- Recurrence rules are bare RRULE bodies (\`FREQ=WEEKLY;BYDAY=MO\` — no \`DTSTART\`).`

/**
 * Schemas z.toJSONSchema could not convert on the last build (the spec falls
 * back to a bare object for them). Empty in practice; the unit test asserts
 * the important schemas convert for real.
 */
export const conversionFallbacks: string[] = []

function toJsonSchema(schema: ZodType, label: string): Record<string, unknown> {
  try {
    const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
    delete json.$schema // implied by the OpenAPI 3.1 dialect
    return json
  }
  catch {
    // Never let one unconvertible schema break the whole document — the
    // route summary/description carries the shape in prose instead.
    if (!conversionFallbacks.includes(label)) conversionFallbacks.push(label)
    return { type: 'object', description: 'Request shape not auto-derivable from the zod schema — see the endpoint description.' }
  }
}

function buildParameters(route: RouteDoc): Record<string, unknown>[] {
  const params: Record<string, unknown>[] = (route.pathParams ?? []).map(name => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }))

  if (route.querySchema) {
    const json = toJsonSchema(route.querySchema, `${route.method.toUpperCase()} ${route.path} query`)
    const properties = (json.properties ?? {}) as Record<string, unknown>
    const required = (json.required ?? []) as string[]
    for (const [name, schema] of Object.entries(properties)) {
      params.push({ name, in: 'query', required: required.includes(name), schema })
    }
  }

  return params
}

function buildRequestBody(route: RouteDoc): Record<string, unknown> | undefined {
  if (route.multipart) {
    return {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            description: 'One or more image files (any part name), ≤25 MB each.',
            properties: {
              file: { type: 'string', format: 'binary', description: 'An image file. Repeat the part to upload several.' },
            },
          },
        },
      },
    }
  }
  if (!route.requestSchema) return undefined
  return {
    required: true,
    content: {
      'application/json': {
        schema: toJsonSchema(route.requestSchema, `${route.method.toUpperCase()} ${route.path} body`),
      },
    },
  }
}

function buildOperation(route: RouteDoc): Record<string, unknown> {
  const parameters = buildParameters(route)
  const requestBody = buildRequestBody(route)
  return {
    summary: route.summary,
    description: AUTH_NOTES[route.auth],
    tags: route.tags,
    // Public routes explicitly opt out of the (empty) document-level default.
    security: route.auth === 'public' ? [] : [{ bearerAuth: [] }],
    ...(parameters.length ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses: {
      200: { description: route.responseDescription },
    },
  }
}

let cached: Record<string, unknown> | null = null

/** Assemble (once per process) the OpenAPI 3.1 document from the registry. */
export function buildOpenApiSpec(): Record<string, unknown> {
  if (cached) return cached

  const paths: Record<string, Record<string, unknown>> = {}
  for (const route of routeRegistry) {
    paths[route.path] ??= {}
    paths[route.path]![route.method] = buildOperation(route)
  }

  cached = {
    openapi: '3.1.0',
    info: {
      title: 'Betts Board API',
      version: VERSION,
      description: INFO_DESCRIPTION,
    },
    servers: [{ url: '/' }],
    tags: Object.entries(TAGS).map(([name, description]) => ({ name, description })),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'API key from Settings → API access (`bb_…`). Session cookies work too — the interactive docs use yours automatically.',
        },
      },
    },
    paths,
  }
  return cached
}
