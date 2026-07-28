import { createError } from 'h3'
import type { Db } from '../../db/client'
import type { photos } from '../../db/schema'
import { getPhoto } from './store'

export type PhotoActor = { id: string, role: 'admin' | 'adult' | 'kid' }

/**
 * Who may destroy a photo.
 *
 * Deleting is not the same act as un-ticking "in slideshow": it removes the
 * row and both files with no undo, and the household photo library is the one
 * thing here that cannot be re-derived from anything. Left at bare
 * `requireProfile`, any kid — and every profile is one tap away, since
 * switching takes no credential — could wipe the family album one photo at a
 * time.
 *
 * The rule is the same one wish lists already use (`canEditList`): adults and
 * admins curate everything, and you can always delete what you uploaded
 * yourself, so a kid can still take back the photo they just added. It is not
 * `requireAdmin` — unlike feeds, API keys and profiles, photos are everyday
 * family content and both parents are not always admins.
 *
 * Photos uploaded before profiles existed, or by an API key, have a null
 * uploader; those belong to no one, so only an adult can remove them.
 */
export function canDeletePhoto(photo: typeof photos.$inferSelect, actor: PhotoActor): boolean {
  return actor.role === 'admin' || actor.role === 'adult' || photo.uploadedByProfileId === actor.id
}

/**
 * Fetch a photo and assert the actor may delete it. Deliberately the only way
 * the delete route gets its row: a bare role check next to the call site is a
 * thing the next destructive photo route can forget to copy.
 */
export function requireDeletablePhoto(db: Db, householdId: string, id: string, actor: PhotoActor) {
  const photo = getPhoto(db, householdId, id)
  if (!photo) throw createError({ statusCode: 404, statusMessage: 'Photo not found' })
  if (!canDeletePhoto(photo, actor)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only an adult, or the person who uploaded it, can delete a photo',
    })
  }
  return photo
}
