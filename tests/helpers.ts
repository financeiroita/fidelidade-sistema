import { buildApp } from '../src/api/app';
import type { GuestRepository } from '../src/application/ports';
import type { Role } from '../src/domain/auth/auth';
import { InMemoryAuditRepository, InMemoryAuthRepository } from '../src/infra/memory/authRepository';
import { InMemoryGuestRepository } from '../src/infra/memory/guestRepository';
import { InMemoryRewardRepository } from '../src/infra/memory/rewardRepository';
import { InMemoryStayRepository } from '../src/infra/memory/stayRepository';
import { newSessionToken } from '../src/infra/security/token';

export const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';

/** Nos testes o limite por IP fica alto, para não atrapalhar; os testes de limite o reduzem. */
const HIGH = 100_000;

export function makeApp(
  repo: GuestRepository = new InMemoryGuestRepository(),
  now?: () => Date,
  limits: { login?: number; password?: number; guests?: number } = { login: HIGH, password: HIGH, guests: HIGH },
  trustProxy?: number,
) {
  const guests = repo as InMemoryGuestRepository;
  const stays = new InMemoryStayRepository(guests);
  const rewards = new InMemoryRewardRepository(stays, guests, now);
  const authRepo = new InMemoryAuthRepository();
  const auditRepo = new InMemoryAuditRepository();
  const auth = { repo: authRepo, audit: auditRepo, now };
  const app = buildApp(
    {
      signup: { repo, documentSecret: SECRET, now },
      loyalty: { stays, now },
      rewards: { repo: rewards, now },
      auth,
    },
    { limits, trustProxy },
  );

  let n = 0;
  /** Cria um funcionário com sessão válida (sem passar pela senha, que é lenta de propósito). */
  const operator = (role: Role, name = `Funcionario ${role}`) => {
    const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    authRepo.operators.set(id, {
      id,
      username: `user${n}`,
      name,
      role,
      passwordHash: 'nao-usado-nos-testes',
      active: true,
      failedAttempts: 0,
      lockedUntil: null,
    });
    const { token, hash } = newSessionToken();
    authRepo.sessions.set(hash, { operatorId: id, expiresAt: new Date('2999-01-01T00:00:00Z') });
    return { id, token, headers: { authorization: `Bearer ${token}` } as Record<string, string> };
  };
  // Gerente por padrão: pode tudo menos administrar funcionários.
  const manager = operator('MANAGER', 'Gerente Teste');

  return { app, guests, stays, rewards, authRepo, auditRepo, auth, operator, headers: manager.headers, manager };
}
