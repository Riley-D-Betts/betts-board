import { z } from 'zod'

export const feedbackCreateSchema = z.object({
  kind: z.enum(['bug', 'feature']),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(10000),
  /** Bugs only: append app version, browser, and screen size to the issue. */
  includeDiagnostics: z.boolean().default(true),
  diagnostics: z.object({
    userAgent: z.string().max(500),
    viewport: z.string().max(50),
    version: z.string().max(50),
  }).optional(),
})

export const feedbackSettingsSchema = z.object({
  /** "owner/name" */
  repo: z.string().trim().regex(/^[\w.-]+\/[\w.-]+$/, 'expected owner/repo').nullable(),
  /** Fine-grained PAT with issues:write; write-only — never returned by the API. */
  token: z.string().trim().min(1).max(200).nullable().optional(),
})

export type FeedbackCreate = z.infer<typeof feedbackCreateSchema>

export interface FeedbackResult {
  ok: true
  issueNumber: number
  issueUrl: string
}

export interface FeedbackStatus {
  configured: boolean
  repo: string | null
}
