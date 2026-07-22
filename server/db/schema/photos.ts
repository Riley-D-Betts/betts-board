import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { id } from './_helpers'
import { households } from './household'
import { profiles } from './profiles'

export const photos = sqliteTable('photos', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  uploadedByProfileId: text('uploaded_by_profile_id').references(() => profiles.id),
  path: text('path').notNull(), // relative to uploads dir
  thumbPath: text('thumb_path').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  takenAt: integer('taken_at', { mode: 'timestamp_ms' }), // from EXIF when present
  inSlideshow: integer('in_slideshow', { mode: 'boolean' }).notNull().default(true),
  uploadedAt: integer('uploaded_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})
