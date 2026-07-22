import { hash } from '@node-rs/argon2'
import { randomBytes } from 'node:crypto'
import { setupSchema } from '#shared/schemas/auth'
import { useDb } from '../db/client'
import { defaultHouseholdSettings, households, profiles } from '../db/schema'
import { getHousehold, setBoardSession } from '../utils/session'

export default defineEventHandler(async (event) => {
  if (getHousehold()) throw createError({ statusCode: 409, statusMessage: 'Already set up' })

  const input = await readValidatedBody(event, setupSchema.parse)
  const db = useDb()

  const household = db.insert(households).values({
    name: input.householdName,
    passwordHash: await hash(input.password),
    timezone: input.timezone,
    latitude: input.latitude,
    longitude: input.longitude,
    locationName: input.locationName,
    icsToken: randomBytes(24).toString('base64url'),
    settings: defaultHouseholdSettings,
  }).returning().get()

  const created = db.insert(profiles).values(
    input.profiles.map((p, i) => ({
      householdId: household.id,
      name: p.name,
      color: p.color,
      role: p.role,
      sortOrder: i,
    })),
  ).returning().all()

  // Setup ends unlocked, acting as the first admin profile.
  const admin = created.find(p => p.role === 'admin')!
  await setBoardSession(event, {
    unlocked: true,
    householdId: household.id,
    profileId: admin.id,
    role: admin.role,
  })

  return { ok: true }
})
