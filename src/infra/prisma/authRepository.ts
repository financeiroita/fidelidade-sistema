import { Prisma, type PrismaClient } from '@prisma/client';
import {
  DuplicateOperatorError,
  type AuditDetails,
  type AuditEntry,
  type AuditRepository,
  type AuthRepository,
  type OperatorRow,
} from '../../application/ports';
import type { Role } from '../../domain/auth/auth';

const toOperator = (o: {
  id: string;
  username: string;
  name: string;
  role: string;
  passwordHash: string;
  active: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
}): OperatorRow => ({ ...o, role: o.role as Role });

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findOperatorByUsername(username: string) {
    const o = await this.prisma.operator.findUnique({ where: { username } });
    return o ? toOperator(o) : null;
  }
  async findOperatorById(id: string) {
    const o = await this.prisma.operator.findUnique({ where: { id } });
    return o ? toOperator(o) : null;
  }
  async createOperator(op: OperatorRow) {
    try {
      await this.prisma.operator.create({ data: op });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new DuplicateOperatorError();
      throw e;
    }
  }
  async listOperators() {
    const rows = await this.prisma.operator.findMany({
      orderBy: { username: 'asc' },
      select: { id: true, username: true, name: true, role: true, active: true, lockedUntil: true },
    });
    return rows.map((r) => ({ ...r, role: r.role as Role }));
  }
  async recordLoginFailure(id: string, max: number, lockUntil: Date) {
    // Um único UPDATE: contagem e trava não se perdem se várias tentativas chegarem juntas.
    await this.prisma.$executeRaw`UPDATE "Operator" SET
      "lockedUntil" = CASE WHEN "failedAttempts" + 1 >= ${max} THEN ${lockUntil} ELSE "lockedUntil" END,
      "failedAttempts" = CASE WHEN "failedAttempts" + 1 >= ${max} THEN 0 ELSE "failedAttempts" + 1 END
      WHERE id = ${id}`;
  }
  async recordLoginSuccess(id: string) {
    await this.prisma.operator.update({ where: { id }, data: { failedAttempts: 0, lockedUntil: null } });
  }
  async setPassword(id: string, passwordHash: string) {
    await this.prisma.operator.update({ where: { id }, data: { passwordHash, failedAttempts: 0, lockedUntil: null } });
  }
  async setActive(id: string, active: boolean) {
    await this.prisma.operator.update({ where: { id }, data: { active } });
  }
  async createSession(s: { tokenHash: string; operatorId: string; expiresAt: Date }) {
    await this.prisma.session.create({ data: s });
  }
  async findSession(tokenHash: string) {
    const s = await this.prisma.session.findUnique({ where: { tokenHash } });
    return s ? { operatorId: s.operatorId, expiresAt: s.expiresAt } : null;
  }
  async deleteSession(tokenHash: string) {
    await this.prisma.session.deleteMany({ where: { tokenHash } });
  }
  async deleteSessionsOf(operatorId: string, exceptTokenHash?: string) {
    await this.prisma.session.deleteMany({
      where: { operatorId, ...(exceptTokenHash ? { tokenHash: { not: exceptTokenHash } } : {}) },
    });
  }
}

export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(e: AuditEntry) {
    await this.prisma.auditLog.create({
      data: {
        at: e.at,
        operatorId: e.operatorId,
        operatorName: e.operatorName,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId,
        ok: e.ok,
        details: e.details as Prisma.InputJsonValue | undefined,
      },
    });
  }
  async list(f: { entity?: string; entityId?: string; operatorId?: string; limit: number }) {
    const rows = await this.prisma.auditLog.findMany({
      where: { entity: f.entity, entityId: f.entityId, operatorId: f.operatorId },
      orderBy: { at: 'desc' },
      take: f.limit,
    });
    return rows.map((r) => ({
      at: r.at,
      operatorId: r.operatorId,
      operatorName: r.operatorName,
      action: r.action,
      entity: r.entity ?? undefined,
      entityId: r.entityId ?? undefined,
      ok: r.ok,
      details: (r.details ?? undefined) as AuditDetails | undefined,
    }));
  }
}
