import { z } from 'zod';

export const REWARD_TYPES = ['FREE_NIGHT', 'UPGRADE', 'DINING', 'SPA', 'DISCOUNT', 'EXPERIENCE'] as const;

export const rewardInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(REWARD_TYPES),
  pointsCost: z.number().int().min(1).max(10_000_000),
  description: z.string().trim().max(300).optional(),
  minTierRank: z.number().int().min(0).max(3).default(0),
});

/** requestId: identificador único do pedido (gerado por quem chama) para o pedido nunca ser feito duas vezes. */
export const redeemSchema = z.object({
  guestId: z.string().uuid(),
  rewardId: z.string().uuid(),
  requestId: z.string().trim().regex(/^[A-Za-z0-9._-]{8,60}$/, 'Use de 8 a 60 letras, números, ponto, hífen ou sublinhado.'),
});

export const useSchema = z.object({ stayId: z.string().uuid().optional() });

export type RewardInput = z.infer<typeof rewardInputSchema>;
export type RedeemInput = z.infer<typeof redeemSchema>;
