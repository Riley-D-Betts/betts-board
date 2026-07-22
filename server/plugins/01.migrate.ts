import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { useDb } from '../db/client'

// Migrations run on every boot so the container behaves like a
// self-upgrading binary — never an exec-into-container step.
export default defineNitroPlugin(() => {
  const candidates = [
    join(process.cwd(), 'drizzle'), // production: shipped next to .output
    new URL('../../drizzle', import.meta.url).pathname, // dev
  ]
  const migrationsFolder = candidates.find(existsSync)
  if (!migrationsFolder) throw new Error('drizzle migrations folder not found')
  migrate(useDb(), { migrationsFolder })
  console.log('[betts-board] database migrated')
})
