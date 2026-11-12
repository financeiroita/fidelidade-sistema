import { z } from 'zod';

export const CHANNELS = ['DIRECT_WEBSITE', 'PHONE', 'WHATSAPP', 'WALK_IN', 'OTA', 'CORPORATE', 'AGENCY'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Reserva direta com o hotel (gera o bônus de +20%). OTA, agência e corporativo não. */
export const isDirectChannel = (c: Channel) => ['DIRECT_WEBSITE', 'PHONE', 'WHATSAPP', 'WALK_IN'].includes(c);

/** Limites de segurança contra erro de digitação e abuso (valores em R$). */
export const LIMITS = { perLine: 200_000, perStayTotal: 500_000, maxLines: 100, yearsBack: 5, yearsAhead: 1 };

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Data inválida.')
  .refine((v) => {
    const y = new Date().getUTCFullYear();
    const year = Number(v.slice(0, 4));
    return year >= y - LIMITS.yearsBack && year <= y + LIMITS.yearsAhead;
  }, 'Data fora do período aceito.');

export const stayInputSchema = z
  .object({
    guestId: z.string().uuid(),
    channel: z.enum(CHANNELS),
    checkIn: isoDate,
    checkOut: isoDate,
    roomType: z.string().trim().max(60).optional(),
    adults: z.number().int().min(1).max(20).default(1),
    children: z.number().int().min(0).max(20).default(0),
    /** Identificador único do lançamento (ex.: número do comprovante) para evitar lançar duas vezes. */
    externalRef: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{1,60}$/, 'Use letras, números, ponto, hífen ou sublinhado.')
      // Sempre em maiúsculas: "res-123" e "RES-123" são o mesmo lançamento (ADR 0016).
      .transform((v) => v.toUpperCase())
      .optional(),
    // Valores líquidos de impostos, em reais com até 2 casas; negativo = estorno.
    charges: z
      .array(
        z.object({
          category: z.enum(['ROOM', 'FNB', 'SPA', 'EVENTS', 'OTHER']),
          amount: z.number().finite().min(-LIMITS.perLine).max(LIMITS.perLine).multipleOf(0.01),
          description: z.string().trim().max(120).optional(),
        }),
      )
      .max(LIMITS.maxLines),
  })
  .refine((v) => v.checkOut > v.checkIn, { path: ['checkOut'], message: 'O check-out deve ser depois do check-in.' })
  .refine((v) => v.charges.reduce((s, c) => s + Math.max(0, c.amount), 0) <= LIMITS.perStayTotal, {
    path: ['charges'],
    message: 'Total da estadia acima do limite permitido.',
  });

export type StayInput = z.infer<typeof stayInputSchema>;

export const nightsBetween = (checkIn: string, checkOut: string) =>
  Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
