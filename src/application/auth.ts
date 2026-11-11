import { randomUUID } from 'node:crypto';
import { passwordProblem, type Principal, type Role } from '../domain/auth/auth';
import { burnPasswordTime, hashPassword, verifyPassword } from '../infra/security/password';
import { hashToken, newSessionToken } from '../infra/security/token';
import {
  CannotDeactivateSelfError,
  CannotResetOwnPasswordError,
  DuplicateOperatorError,
  InvalidCredentialsError,
  LastAdminError,
  OperatorNotFoundError,
  WeakPasswordError,
  type AuditDetails,
  type AuditRepository,
  type AuthRepository,
  type OperatorRow,
} from './ports';

export interface AuthDeps {
  repo: AuthRepository;
  audit: AuditRepository;
  now?: () => Date;
  sessionHours?: number;
  /** Falhas seguidas antes de travar a conta, e por quantos minutos. */
  lockout?: { attempts: number; minutes: number };
  /** Chamado (só com o código do erro) quando a gravação da auditoria falha. */
  onAuditError?: (code: string) => void;
}

const clock = (deps: AuthDeps) => (deps.now ?? (() => new Date()))();
const sessionMs = (deps: AuthDeps) => (deps.sessionHours ?? 12) * 3_600_000;
const lockout = (deps: AuthDeps) => deps.lockout ?? { attempts: 5, minutes: 15 };

/**
 * Grava no registro de auditoria. Se a gravação falhar, a operação (já feita) não é desfeita:
 * o erro vai para o log técnico, só com o código, sem dados pessoais. Ver ADR 0010.
 */
export async function audit(
  deps: AuthDeps,
  who: Principal | null,
  action: string,
  extra: { entity?: string; entityId?: string; ok?: boolean; details?: AuditDetails } = {},
  onError?: (code: string) => void,
): Promise<void> {
  try {
    await deps.audit.record({
      at: clock(deps),
      operatorId: who?.operatorId ?? null,
      operatorName: who?.name ?? null,
      action,
      entity: extra.entity,
      entityId: extra.entityId,
      ok: extra.ok ?? true,
      details: extra.details,
    });
  } catch (e) {
    (onError ?? deps.onAuditError)?.((e as { code?: string; name?: string })?.code ?? (e as Error)?.name ?? 'erro');
  }
}

const principalOf = (op: OperatorRow): Principal => ({
  operatorId: op.id,
  username: op.username,
  name: op.name,
  role: op.role,
});

const isLocked = (op: OperatorRow, now: Date) => !!op.lockedUntil && op.lockedUntil > now;

/**
 * Entra com usuário e senha. A mesma resposta para usuário inexistente, errado, inativo ou travado,
 * e o mesmo tempo gasto em todos os casos.
 */
export async function login(
  deps: AuthDeps,
  input: { username: string; password: string },
): Promise<{ token: string; expiresAt: Date; operator: Principal }> {
  const now = clock(deps);
  const username = input.username.trim().toLowerCase();
  const op = await deps.repo.findOperatorByUsername(username);

  if (!op) {
    // Usuário desconhecido: gasta o mesmo tempo e NÃO grava na auditoria (qualquer pessoa na internet
    // encheria o histórico, e o texto digitado pode ser uma senha no campo errado).
    await burnPasswordTime(input.password);
    throw new InvalidCredentialsError();
  }
  if (!op.active || isLocked(op, now)) {
    await burnPasswordTime(input.password);
    await audit(deps, principalOf(op), 'auth.login', { ok: false, details: { reason: 'bloqueado' } });
    throw new InvalidCredentialsError();
  }
  if (!(await verifyPassword(input.password, op.passwordHash))) {
    const l = lockout(deps);
    await deps.repo.recordLoginFailure(op.id, l.attempts, new Date(now.getTime() + l.minutes * 60_000));
    await audit(deps, principalOf(op), 'auth.login', { ok: false, details: { reason: 'senha' } });
    throw new InvalidCredentialsError();
  }

  // Relê depois da senha (que demora): uma rajada pode ter travado ou desativado a conta nesse meio tempo.
  const fresh = await deps.repo.findOperatorById(op.id);
  if (!fresh || !fresh.active || isLocked(fresh, clock(deps))) {
    await audit(deps, principalOf(op), 'auth.login', { ok: false, details: { reason: 'bloqueado' } });
    throw new InvalidCredentialsError();
  }

  await deps.repo.recordLoginSuccess(op.id);
  const { token, hash } = newSessionToken();
  const expiresAt = new Date(now.getTime() + sessionMs(deps));
  await deps.repo.createSession({ tokenHash: hash, operatorId: op.id, expiresAt });
  await audit(deps, principalOf(op), 'auth.login');
  return { token, expiresAt, operator: principalOf(op) };
}

/** Quem é o dono do token? null se inexistente, expirado ou funcionário desativado. */
export async function authenticate(deps: AuthDeps, token: string): Promise<Principal | null> {
  const session = await deps.repo.findSession(hashToken(token));
  if (!session || session.expiresAt <= clock(deps)) return null;
  const op = await deps.repo.findOperatorById(session.operatorId);
  return op && op.active ? principalOf(op) : null;
}

export const logout = (deps: AuthDeps, token: string) => deps.repo.deleteSession(hashToken(token));

export async function createOperator(
  deps: AuthDeps,
  input: { username: string; name: string; role: Role; password: string },
): Promise<Principal> {
  const problem = passwordProblem(input.password, input.username);
  if (problem) throw new WeakPasswordError(problem);
  if (await deps.repo.findOperatorByUsername(input.username)) throw new DuplicateOperatorError();
  const op: OperatorRow = {
    id: randomUUID(),
    username: input.username,
    name: input.name,
    role: input.role,
    passwordHash: await hashPassword(input.password),
    active: true,
    failedAttempts: 0,
    lockedUntil: null,
  };
  await deps.repo.createOperator(op);
  return principalOf(op);
}

/**
 * O próprio funcionário troca a senha: exige a senha atual e encerra as outras sessões dele.
 * Errar a senha atual conta como falha de login (e trava), para quem roubou uma sessão não
 * ficar adivinhando a senha por aqui.
 */
export async function changeOwnPassword(
  deps: AuthDeps,
  who: Principal,
  currentToken: string,
  input: { current: string; next: string },
): Promise<void> {
  const now = clock(deps);
  const op = await deps.repo.findOperatorById(who.operatorId);
  if (!op || isLocked(op, now)) {
    await burnPasswordTime(input.current);
    throw new InvalidCredentialsError();
  }
  if (!(await verifyPassword(input.current, op.passwordHash))) {
    const l = lockout(deps);
    await deps.repo.recordLoginFailure(op.id, l.attempts, new Date(now.getTime() + l.minutes * 60_000));
    throw new InvalidCredentialsError();
  }
  const problem = passwordProblem(input.next, op.username);
  if (problem) throw new WeakPasswordError(problem);
  await deps.repo.setPassword(op.id, await hashPassword(input.next));
  await deps.repo.deleteSessionsOf(op.id, hashToken(currentToken));
}

/**
 * Administrador redefine a senha de OUTRA pessoa e encerra as sessões dela.
 * A própria senha só se troca pela rota própria (exige a senha atual): um token de administrador
 * roubado não consegue trocar a senha do dono.
 */
export async function adminResetPassword(
  deps: AuthDeps,
  who: Principal,
  operatorId: string,
  password: string,
): Promise<void> {
  if (who.operatorId === operatorId) throw new CannotResetOwnPasswordError();
  const op = await deps.repo.findOperatorById(operatorId);
  if (!op) throw new OperatorNotFoundError();
  const problem = passwordProblem(password, op.username);
  if (problem) throw new WeakPasswordError(problem);
  await deps.repo.setPassword(op.id, await hashPassword(password));
  await deps.repo.deleteSessionsOf(op.id);
}

export async function setOperatorActive(deps: AuthDeps, who: Principal, operatorId: string, active: boolean) {
  if (active) {
    if (!(await deps.repo.findOperatorById(operatorId))) throw new OperatorNotFoundError();
    await deps.repo.setActive(operatorId, true);
    return;
  }
  if (who.operatorId === operatorId) throw new CannotDeactivateSelfError();
  const r = await deps.repo.deactivateOperatorGuarded(operatorId);
  if (r === 'not_found') throw new OperatorNotFoundError();
  if (r === 'last_admin') throw new LastAdminError();
  await deps.repo.deleteSessionsOf(operatorId);
}

export const listOperators = (deps: AuthDeps) => deps.repo.listOperators();
