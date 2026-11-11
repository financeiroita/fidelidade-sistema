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

/** Papel desconhecido (ex.: valor inesperado vindo do banco) não tem permissão nenhuma. */
export const can = (role: Role, permission: Permission) =>
  (RANK[role] ?? 0) >= RANK[PERMISSIONS[permission]];

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

// Lista curta de senhas muito comuns com 12 caracteres ou mais. Não substitui uma lista grande.
const COMMON_PASSWORDS = new Set([
  'password1234', 'password12345', 'senha1234567', 'senha12345678', '123456789012', '1234567890ab',
  'qwertyuiop12', 'qwerty123456', 'abcdef123456', 'abc123456789', 'iloveyou1234', 'administrador',
  'administrator', 'mudar123456', 'trocar123456', 'hotel1234567', 'hotel12345678', 'bemvindo1234',
  'brasil123456', 'fidelidade123', 'fidelidade1234', 'recepcao1234', 'recepcao12345',
]);

/**
 * Política de senha. Mede depois da normalização (NFKC), que é o que realmente entra no hash:
 * comprimento e variedade em caracteres reais, não em unidades de texto.
 */
export function passwordProblem(password: string, username?: string): string | null {
  const p = password.normalize('NFKC');
  const chars = [...p];
  if (chars.length < 12) return 'A senha deve ter pelo menos 12 caracteres.';
  if (chars.length > 128) return 'A senha deve ter no máximo 128 caracteres.';
  if (new Set(chars).size < 6) return 'A senha tem caracteres demais repetidos.';
  if (COMMON_PASSWORDS.has(p.toLowerCase())) return 'Essa senha é muito comum. Escolha outra.';
  if (username && p.toLowerCase().includes(username.normalize('NFKC').toLowerCase())) {
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

/** Filtros da consulta de auditoria: textos simples e curtos (nada de listas repetidas). */
export const auditQuerySchema = z.object({
  entity: z.string().regex(/^[a-z-]{1,40}$/).optional(),
  entityId: z.string().max(60).optional(),
  operatorId: z.string().uuid().optional(),
  limit: z.coerce.number().int().optional(),
});
