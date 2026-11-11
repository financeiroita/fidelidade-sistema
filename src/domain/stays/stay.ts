import { z } from 'zod';

export const CHANNELS = ['DIRECT_WEBSITE', 'PHONE', 'WHATSAPP', 'WALK_IN', 'OTA', 'CORPORATE', 'AGENCY'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Reserva direta com o hotel (gera o bônus de +20%). OTA, agência e corporativo não. */
export const isDirectChannel = (c: Channel) => ['DIRECT_WEBSITE', 'PHONE', 'WHATSAPP', 'WALK_IN'].includes(c);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Data inválida.');

export const stayInputSchema = z
  .object({
    guestId: z.string().uuid(),
    channel: z.enum(CHANNELS),
    checkIn: isoDate,
    checkOut: isoDate,
    roomType: z.string().trim().max(60).optional(),
    adults: z.number().int().min(1).max(20).default(1),
    children: z.number().int().min(0).max(20).default(0),
    // Valores líquidos de impostos; negativo = estorno.
    charges: z
      .array(
        z.object({
          category: z.enum(['ROOM', 'FNB', 'SPA', 'EVENTS', 'OTHER']),
          amount: z.number().finite().min(-1_000_000).max(1_000_000),
          description: z.string().trim().max(120).optional(),
        }),
      )
      .max(500),
  })
  .refine((v) => v.checkOut > v.checkIn, { path: ['checkOut'], message: 'O check-out deve ser depois do check-in.' });

export type StayInput = z.infer<typeof stayInputSchema>;

export const nightsBetween = (checkIn: string, checkOut: string) =>
  Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
