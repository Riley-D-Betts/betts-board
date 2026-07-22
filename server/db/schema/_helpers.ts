import { text, integer } from 'drizzle-orm/sqlite-core'
import { v7 as uuidv7 } from 'uuid'

/** UUIDv7 text PK: time-sortable, portable to Postgres, no autoincrement coupling. */
export const id = () => text('id').primaryKey().$defaultFn(() => uuidv7())

export const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())

export const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date())
