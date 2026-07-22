import { z } from 'zod'
import { zHexColor, zIanaTimezone, zId } from './common'

export const setupProfileSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: zHexColor,
  role: z.enum(['admin', 'adult', 'kid']),
})

export const setupSchema = z.object({
  householdName: z.string().trim().min(1).max(100),
  password: z.string().min(6).max(200),
  timezone: zIanaTimezone,
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  locationName: z.string().trim().max(200).optional(),
  profiles: z.array(setupProfileSchema).min(1).max(20)
    .refine(list => list.some(p => p.role === 'admin'), 'at least one admin profile required'),
})

export const unlockSchema = z.object({
  password: z.string().min(1).max(200),
})

export const switchProfileSchema = z.object({
  profileId: zId,
})

export type SetupInput = z.infer<typeof setupSchema>
