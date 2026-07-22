import { z } from 'zod'
import { zHexColor } from './common'

export const profileCreateSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: zHexColor,
  role: z.enum(['admin', 'adult', 'kid']).default('adult'),
  sortOrder: z.number().int().optional(),
})

export const profilePatchSchema = profileCreateSchema.partial().extend({
  archived: z.boolean().optional(),
})

export type ProfileCreate = z.infer<typeof profileCreateSchema>
export type ProfilePatch = z.infer<typeof profilePatchSchema>
