import { createHash, randomBytes } from 'node:crypto';

/** Token de sessão: 256 bits aleatórios. Só o hash vai para o banco. */
export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
