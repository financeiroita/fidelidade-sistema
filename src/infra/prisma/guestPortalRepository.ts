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
    limit: { since: Date; max: number },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Trava o hóspede: pedidos simultâneos não passam do limite.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Guest" WHERE id = ${c.guestId} AND "deletedAt" IS NULL FOR UPDATE`;
      if (rows.length === 0) return false;
      const recent = await tx.guestLoginCode.count({ where: { guestId: c.guestId, createdAt: { gte: limit.since } } });
      if (recent >= limit.max) return false;
      // Só o código mais novo vale.
      await tx.guestLoginCode.updateMany({ where: { guestId: c.guestId, usedAt: null }, data: { usedAt: c.now } });
      await tx.guestLoginCode.create({
        data: { id: c.id, guestId: c.guestId, codeHash: c.codeHash, expiresAt: c.expiresAt, createdAt: c.now },
      });
      return true;
    });
  }

  async verifyLoginCode(guestId: string, codeHash: string, now: Date, maxAttempts: number): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Trava o código: tentativas simultâneas são contadas uma a uma.
      const rows = await tx.$queryRaw<Array<{ id: string; codeHash: string; attempts: number }>>`
        SELECT id, "codeHash", attempts FROM "GuestLoginCode"
        WHERE "guestId" = ${guestId} AND "usedAt" IS NULL AND "expiresAt" > ${now}
        ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`;
      const code = rows[0];
      if (!code) return false;
      if (sameHash(code.codeHash, codeHash)) {
        await tx.guestLoginCode.update({ where: { id: code.id }, data: { usedAt: now } });
        return true;
      }
      const attempts = code.attempts + 1;
      await tx.guestLoginCode.update({
        where: { id: code.id },
        data: { attempts, usedAt: attempts >= maxAttempts ? now : null },
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
