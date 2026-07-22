import { z } from 'zod'

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(500).optional(),
})

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
})
