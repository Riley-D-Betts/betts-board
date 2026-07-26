import { sql } from 'drizzle-orm'
import { useDb } from '../db/client'

export default defineEventHandler(() => {
  // Verifies the DB file is openable, not just that the process is up.
  useDb().run(sql`SELECT 1`)

  // Build identity rides along, so "did my rebuild actually take?" is
  // answerable from a phone browser without logging in. The Docker HEALTHCHECK
  // only tests the status code, so the extra fields are safe.
  const { build } = useRuntimeConfig().public
  return { ok: true, ...build }
})
