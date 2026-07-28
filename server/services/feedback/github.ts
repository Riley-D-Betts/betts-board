import { createError } from 'h3'
import type { FeedbackResult } from '#shared/schemas/feedback'
import type { Db } from '../../db/client'
import { households } from '../../db/schema'
import { readCappedBody } from '../../utils/safeFetch'

// Overridable for tests and for self-hosters on GitHub Enterprise.
const GITHUB_API_URL = process.env.BETTS_GITHUB_API_URL || 'https://api.github.com'
const FETCH_TIMEOUT_MS = 10_000
/** An issue or a repo record is a few KB; 2 MB is already absurdly generous. */
const MAX_RESPONSE_BYTES = 2_000_000

export const APP_VERSION = '1.0.0'

/** Repo + token from the household row, or 409 until the admin connects one. */
function requireConnection(db: Db): { repo: string, token: string } {
  const hh = db.select({
    githubRepo: households.githubRepo,
    githubToken: households.githubToken,
  }).from(households).limit(1).get()
  if (!hh?.githubRepo || !hh.githubToken) {
    throw createError({ statusCode: 409, statusMessage: 'Feedback is not connected to GitHub yet' })
  }
  return { repo: hh.githubRepo, token: hh.githubToken }
}

/** GitHub failures become 502s with messages an admin can act on. */
function mapGithubError(status: number): never {
  if (status === 401 || status === 403) {
    throw createError({ statusCode: 502, statusMessage: 'GitHub rejected the token' })
  }
  if (status === 404) {
    throw createError({ statusCode: 502, statusMessage: 'Repo not found or token lacks access' })
  }
  if (status === 410) {
    throw createError({ statusCode: 502, statusMessage: 'Issues are disabled on the repo' })
  }
  throw createError({ statusCode: 502, statusMessage: `GitHub returned an unexpected response (HTTP ${status})` })
}

/**
 * One request, body included.
 *
 * The timeout is `AbortSignal.timeout`, not a `setTimeout` cleared when
 * `fetch()` resolves: that older shape disarmed itself the moment the HEADERS
 * arrived, so the JSON was then read with nothing armed at all and a host that
 * dribbles out an endless response filled this container's memory. The signal
 * here stays armed until the last byte, and `readCappedBody` stops the stream
 * at the cap rather than buffering first and measuring afterwards.
 */
async function githubFetch<T>(path: string, token: string, init: { method?: string, body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${GITHUB_API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'betts-board',
        ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: 'Could not reach GitHub' })
  }
  if (!res.ok) {
    void res.body?.cancel().catch(() => {})
    mapGithubError(res.status)
  }

  let bytes: Uint8Array
  try {
    bytes = await readCappedBody(res, MAX_RESPONSE_BYTES)
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: 'Could not reach GitHub' })
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: 'GitHub returned a response we could not read' })
  }
}

export interface CreateIssueInput {
  kind: 'bug' | 'feature'
  title: string
  body: string
  /** Family member name — issues are attributed in the body, not by account. */
  reporterName: string
  /** Bugs only, when the reporter opted in on the form. */
  diagnostics?: { userAgent: string, viewport: string, version?: string }
}

/** File the feedback as a real GitHub issue on the household's configured repo. */
export async function createIssue(db: Db, input: CreateIssueInput): Promise<FeedbackResult> {
  const { repo, token } = requireConnection(db)

  const footer = [
    '---',
    `Reported by ${input.reporterName} via Betts Board v${input.diagnostics?.version || APP_VERSION}`,
  ]
  if (input.diagnostics) {
    footer.push(`Browser: ${input.diagnostics.userAgent}`, `Viewport: ${input.diagnostics.viewport}`)
  }

  const issue = await githubFetch<{ number: number, html_url: string }>(`/repos/${repo}/issues`, token, {
    method: 'POST',
    body: {
      title: input.title,
      body: `${input.body}\n\n${footer.join('\n')}`,
      labels: [input.kind === 'bug' ? 'bug' : 'enhancement'],
    },
  })
  return { ok: true, issueNumber: issue.number, issueUrl: issue.html_url }
}

/** Settings "Test connection": can the stored token actually see the repo? */
export async function testConnection(db: Db): Promise<{ ok: true, repoFullName: string }> {
  const { repo, token } = requireConnection(db)
  const data = await githubFetch<{ full_name?: string }>(`/repos/${repo}`, token)
  return { ok: true, repoFullName: data.full_name ?? repo }
}
