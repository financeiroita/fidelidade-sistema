import { z } from 'zod';

export const ROLES = ['RECEPTION', 'MANAGER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { RECEPTION: 1, MANAGER: 2, ADMIN: 3 };

/**
 * Menor papel que pode executar cada ação (ADR 0010). O papel mais alto herda o dos mais baixos.
 * Valores iniciais sugeridos; o hotel pode ajustar.
 */
export const PERMISSIONS = {
  'stay:write': 'RECEPTION',
  'checkout:run': 'RECEPTION',
  'redemption:create': 'RECEPTION',
  'redemption:confirm': 'RECEPTION',
  'redemption:use': 'RECEPTION',
  'redemption:cancel': 'MANAGER', // devolve pontos: exige gerente
  'guest:read-points': 'RECEPTION',
  'reward:write': 'MANAGER',
  'audit:read': 'MANAGER',
  'operator:admin': 'ADMIN',
} as const satisfies Record<string, Role>;
export type Permission = keyof typeof PERMISSIONS;

export const can = (role: Role, permission: Permission) => RANK[role] >= RANK[PERMISSIONS[permission]];

export interface Principal {
  operatorId: string;
  username: string;
  name: string;
  role: Role;
}

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, 'Use de 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado.');

/** Política de senha: comprimento e variedade, e não pode conter o usuário. */
export function passwordProblem(password: string, username?: string): string | null {
  if (password.length < 12) return 'A senha deve ter pelo menos 12 caracteres.';
  if (password.length > 128) return 'A senha deve ter no máximo 128 caracteres.';
  if (new Set(password).size < 6) return 'A senha tem caracteres demais repetidos.';
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    return 'A senha não pode conter o nome de usuário.';
  }
  return null;
}

export const loginSchema = z.object({ username: z.string().max(60), password: z.string().min(1).max(128) });
export const createOperatorSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(2).max(80),
  role: z.enum(ROLES),
  password: z.string().max(128),
});
export const changePasswordSchema = z.object({ current: z.string().max(128), next: z.string().max(128) });
export const resetPasswordSchema = z.object({ password: z.string().max(128) });
