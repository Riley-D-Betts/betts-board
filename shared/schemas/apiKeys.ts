import { z } from 'zod'
import { zId } from './common'

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  /** Optional acting profile the key's requests run as. Without one the key
   * can only call routes that don't attribute actions to a person. */
  profileId: zId.nullish(),
})

export interface ApiKeyDto {
  id: string
  name: string
  profileId: string | null
  profileName: string | null
  lastUsedAt: number | null
  createdAt: number
  revoked: boolean
}

/** Returned exactly once, at creation. */
export interface ApiKeyCreated extends ApiKeyDto {
  token: string
}
