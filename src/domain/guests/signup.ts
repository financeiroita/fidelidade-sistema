import { z } from 'zod';
import { isValidCpf, onlyDigits } from './cpf';

const optionalText = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v ? v : undefined));

export const signupSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .refine((v) => v.split(/\s+/).length >= 2, 'Informe nome e sobrenome.'),
    email: z.string().trim().toLowerCase().email().max(160),
    phone: z
      .string()
      .transform(onlyDigits)
      .refine((v) => v.length >= 10 && v.length <= 15, 'Telefone inválido.'),
    documentType: z.enum(['CPF', 'PASSPORT']),
    document: z.string().trim().min(5).max(30),
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
      .refine((v) => {
        const d = new Date(`${v}T00:00:00Z`);
        return !Number.isNaN(d.getTime()) && d <= new Date() && d.getUTCFullYear() >= 1900;
      }, 'Data de nascimento inválida.'),
    city: optionalText,
    state: optionalText,
    travelProfile: optionalText,
    acquisitionSrc: optionalText,
    referralCode: z
      .string()
      .trim()
      .toUpperCase()
      .max(20)
      .optional()
      .transform((v) => (v ? v : undefined)),
    acceptedTerms: z.literal(true, { errorMap: () => ({ message: 'É preciso aceitar o regulamento.' }) }),
    marketingConsent: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.documentType === 'CPF' && !isValidCpf(v.document)) {
      ctx.addIssue({ code: 'custom', path: ['document'], message: 'CPF inválido.' });
    }
  });

export type SignupInput = z.infer<typeof signupSchema>;
