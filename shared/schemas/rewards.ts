import { z } from 'zod'
import { zId } from './common'

export const rewardCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  emoji: z.string().max(8).nullish(),
  description: z.string().max(1000).nullish(),
  cost: z.number().int().min(1).max(100000),
  sortOrder: z.number().int().optional(),
})

export const rewardPatchSchema = rewardCreateSchema.partial().extend({
  archived: z.boolean().optional(),
})

export const redeemSchema = z.object({
  /** Defaults to the acting profile; kids may only redeem for themselves. */
  profileId: zId.optional(),
})

export type RewardCreate = z.infer<typeof rewardCreateSchema>

export interface StarBalance {
  profileId: string
  name: string
  color: string
  earned: number
  spent: number
  balance: number
}

export interface RedemptionRow {
  id: string
  rewardId: string
  title: string
  emoji?: string | null
  costPoints: number
  profileId: string
  profileName: string
  profileColor: string
  redeemedAt: number
}
