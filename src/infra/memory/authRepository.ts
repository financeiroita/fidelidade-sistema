import {
  DuplicateOperatorError,
  type AuditEntry,
  type AuditRepository,
  type AuthRepository,
  type OperatorRow,
} from '../../application/ports';

/** Implementação em memória, usada nos testes. */
export class InMemoryAuthRepository implements AuthRepository {
  operators = new Map<string, OperatorRow>();
  sessions = new Map<string, { operatorId: string; expiresAt: Date }>();

  // Devolve cópias, como o banco: quem chama não altera o registro guardado.
  async findOperatorByUsername(username: string) {
    const o = [...this.operators.values()].find((x) => x.username === username);
    return o ? { ...o } : null;
  }
  async findOperatorById(id: string) {
    const o = this.operators.get(id);
    return o ? { ...o } : null;
  }
  async deactivateOperatorGuarded(id: string) {
    // Sem espera entre a checagem e a gravação: atômico, como a transação do banco.
    const target = this.operators.get(id);
    if (!target) return 'not_found' as const;
    const admins = [...this.operators.values()].filter((o) => o.role === 'ADMIN' && o.active).length;
    if (target.role === 'ADMIN' && target.active && admins <= 1) return 'last_admin' as const;
    target.active = false;
    return 'ok' as const;
  }
  async createOperator(op: OperatorRow) {
    if ([...this.operators.values()].some((o) => o.username === op.username)) throw new DuplicateOperatorError();
    this.operators.set(op.id, { ...op });
  }
  async listOperators() {
    return [...this.operators.values()].map(({ passwordHash: _p, failedAttempts: _f, ...rest }) => rest);
  }
  async recordLoginFailure(id: string, max: number, lockUntil: Date) {
    const o = this.operators.get(id);
    if (!o) return;
    o.failedAttempts += 1;
    if (o.failedAttempts >= max) {
      o.lockedUntil = lockUntil;
      o.failedAttempts = 0;
    }
  }
  async recordLoginSuccess(id: string) {
    const o = this.operators.get(id);
    if (o) {
      o.failedAttempts = 0;
      o.lockedUntil = null;
    }
  }
  async setPassword(id: string, passwordHash: string) {
    const o = this.operators.get(id);
    if (o) {
      o.passwordHash = passwordHash;
      o.failedAttempts = 0; // igual ao banco: senha nova destrava a conta
      o.lockedUntil = null;
    }
  }
  async setActive(id: string, active: boolean) {
    const o = this.operators.get(id);
    if (o) o.active = active;
  }
  async createSession(s: { tokenHash: string; operatorId: string; expiresAt: Date }) {
    this.sessions.set(s.tokenHash, { operatorId: s.operatorId, expiresAt: s.expiresAt });
  }
  async findSession(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
  async deleteSessionsOf(operatorId: string, exceptTokenHash?: string) {
    for (const [hash, s] of this.sessions) {
      if (s.operatorId === operatorId && hash !== exceptTokenHash) this.sessions.delete(hash);
    }
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  entries: AuditEntry[] = [];
  /** Para testar falha na gravação. */
  failNext = false;

  async record(entry: AuditEntry) {
    if (this.failNext) {
      this.failNext = false;
      throw Object.assign(new Error('banco fora'), { code: 'P1001' });
    }
    this.entries.push(entry);
  }
  async list(f: { entity?: string; entityId?: string; operatorId?: string; limit: number }) {
    return this.entries
      .map((e, i) => ({ e, i }))
      .filter(
        ({ e }) =>
          (!f.entity || e.entity === f.entity) &&
          (!f.entityId || e.entityId === f.entityId) &&
          (!f.operatorId || e.operatorId === f.operatorId),
      )
      .sort((a, b) => b.e.at.getTime() - a.e.at.getTime() || b.i - a.i)
      .slice(0, f.limit)
      .map(({ e }) => e);
  }
}
