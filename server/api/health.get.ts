import { sql } from 'drizzle-orm'
import { useDb } from '../db/client'

export default defineEventHandler(() => {
  // Verifies the DB file is openable, not just that the process is up.
  useDb().run(sql`SELECT 1`)
  return { ok: true }
})
