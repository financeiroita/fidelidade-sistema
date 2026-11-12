import type { PrismaClient } from '@prisma/client';
import { sameHash } from '../../application/guestPortal';
import type { GuestAccount, GuestPortalRepository } from '../../application/ports';

export class PrismaGuestPortalRepository implements GuestPortalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveGuestByEmail(email: string) {
    const g = await this.prisma.guest.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, email: true, fullName: true },
    });
    return g && g.email ? { id: g.id, email: g.email, fullName: g.fullName } : null;
  }

  async issueLoginCode(
    c: { id: string; guestId: string; codeHash: string; expiresAt: Date; now: Date },
    limits: Array<{ since: Date; max: number }>,
    block: { failuresSince: Date; maxFailures: number },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Trava o hóspede: pedidos simultâneos não passam do limite.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Guest" WHERE id = ${c.guestId} AND "deletedAt" IS NULL FOR UPDATE`;
      if (rows.length === 0) return false;
      for (const l of limits) {
        const recent = await tx.guestLoginCode.count({ where: { guestId: c.guestId, createdAt: { gte: l.since } } });
        if (recent >= l.max) return false;
      }
      // Bloqueado por erros: não adianta mandar código que não vai funcionar.
      const failed = await tx.guestLoginCode.aggregate({
        where: { guestId: c.guestId, createdAt: { gte: block.failuresSince } },
        _sum: { attempts: true },
      });
      if ((failed._sum.attempts ?? 0) >= block.maxFailures) return false;
      await tx.guestLoginCode.create({
        data: { id: c.id, guestId: c.guestId, codeHash: c.codeHash, expiresAt: c.expiresAt, createdAt: c.now },
      });
      return true;
    });
  }

  async verifyLoginCode(
    guestId: string,
    codeHash: string,
    now: Date,
    policy: { maxAttemptsPerCode: number; maxFailures: number; failuresSince: Date },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Trava os códigos do hóspede (24 h): tentativas simultâneas são contadas uma a uma.
      const rows = await tx.$queryRaw<
        Array<{ id: string; codeHash: string; attempts: number; usedAt: Date | null; expiresAt: Date }>
      >`SELECT id, "codeHash", attempts, "usedAt", "expiresAt" FROM "GuestLoginCode"
        WHERE "guestId" = ${guestId} AND "createdAt" >= ${policy.failuresSince}
        ORDER BY "createdAt" DESC FOR UPDATE`;
      const failures = rows.reduce((s, r) => s + r.attempts, 0);
      if (failures >= policy.maxFailures) return false; // bloqueado até completar 24 h
      const valid = rows.filter((r) => r.usedAt === null && r.expiresAt > now);
      if (valid.length === 0) return false;
      // Compara com todos (sem parar no primeiro), em tempo constante.
      const match = valid.map((r) => sameHash(r.codeHash, codeHash)).includes(true);
      if (match) {
        await tx.guestLoginCode.updateMany({ where: { id: { in: valid.map((r) => r.id) } }, data: { usedAt: now } });
        return true;
      }
      const newest = valid[0];
      const attempts = newest.attempts + 1;
      await tx.guestLoginCode.update({
        where: { id: newest.id },
        data: { attempts, usedAt: attempts >= policy.maxAttemptsPerCode ? now : null },
      });
      return false;
    });
  }

  async createGuestSession(s: { tokenHash: string; guestId: string; expiresAt: Date; now: Date }) {
    await this.prisma.guestSession.create({
      data: { tokenHash: s.tokenHash, guestId: s.guestId, expiresAt: s.expiresAt, createdAt: s.now },
    });
  }

  async findGuestSession(tokenHash: string) {
    const s = await this.prisma.guestSession.findUnique({
      where: { tokenHash },
      select: { guestId: true, expiresAt: true, guest: { select: { deletedAt: true } } },
    });
    return s && s.guest.deletedAt === null ? { guestId: s.guestId, expiresAt: s.expiresAt } : null;
  }

  async deleteGuestSession(tokenHash: string) {
    await this.prisma.guestSession.deleteMany({ where: { tokenHash } });
  }

  async getAccount(guestId: string): Promise<GuestAccount | null> {
    const g = await this.prisma.guest.findFirst({
      where: { id: guestId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        tierValidUntil: true,
        referralCode: true,
        memberSince: true,
        tier: { select: { rank: true } },
      },
    });
    return g
      ? {
          id: g.id,
          fullName: g.fullName,
          tierRank: g.tier.rank,
          tierValidUntil: g.tierValidUntil,
          referralCode: g.referralCode,
          memberSince: g.memberSince,
        }
      : null;
  }

  async upcomingExpirations(guestId: string, now: Date, limit: number) {
    const rows = await this.prisma.pointsTransaction.groupBy({
      by: ['expiresAt'],
      where: { guestId, remaining: { gt: 0 }, expiresAt: { gt: now } },
      _sum: { remaining: true },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({ expiresAt: r.expiresAt as Date, points: r._sum.remaining ?? 0 }));
  }
}
