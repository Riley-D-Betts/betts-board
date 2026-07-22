import { createError } from 'h3'
import type { FeedbackResult } from '#shared/schemas/feedback'
import type { Db } from '../../db/client'
import { households } from '../../db/schema'

// Overridable for tests and for self-hosters on GitHub Enterprise.
const GITHUB_API_URL = process.env.BETTS_GITHUB_API_URL || 'https://api.github.com'
const FETCH_TIMEOUT_MS = 10_000

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

async function githubFetch(path: string, token: string, init: { method?: string, body?: unknown } = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
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
      signal: controller.signal,
    })
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: 'Could not reach GitHub' })
  }
  finally {
    clearTimeout(timer)
  }
  if (!res.ok) mapGithubError(res.status)
  return res
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

  const res = await githubFetch(`/repos/${repo}/issues`, token, {
    method: 'POST',
    body: {
      title: input.title,
      body: `${input.body}\n\n${footer.join('\n')}`,
      labels: [input.kind === 'bug' ? 'bug' : 'enhancement'],
    },
  })
  const issue = await res.json() as { number: number, html_url: string }
  return { ok: true, issueNumber: issue.number, issueUrl: issue.html_url }
}

/** Settings "Test connection": can the stored token actually see the repo? */
export async function testConnection(db: Db): Promise<{ ok: true, repoFullName: string }> {
  const { repo, token } = requireConnection(db)
  const res = await githubFetch(`/repos/${repo}`, token)
  const data = await res.json() as { full_name?: string }
  return { ok: true, repoFullName: data.full_name ?? repo }
}
