import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { join } from 'node:path'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

let _db: Db | null = null

export function createDb(path: string): Db {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  return drizzle(sqlite, { schema })
}

/** Process-wide singleton. Services should call this, never create their own. */
export function useDb(): Db {
  if (!_db) _db = createDb(join(dataDir(), 'betts.db'))
  return _db
}

/** Test hook: swap in an in-memory db. */
export function setDb(db: Db) {
  _db = db
}
