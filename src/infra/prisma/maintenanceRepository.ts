import { Prisma, type PrismaClient } from '@prisma/client';
import type { MaintenanceRepository } from '../../application/ports';
import type { ExpirationPlan, LotRow, NoticePlan } from '../../domain/points/maintenance';

export class PrismaMaintenanceRepository implements MaintenanceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async loadActiveLots(): Promise<LotRow[]> {
    const rows = await this.prisma.pointsTransaction.findMany({
      where: { remaining: { gt: 0 }, expiresAt: { not: null } },
      select: { id: true, guestId: true, remaining: true, expiresAt: true },
    });
    return rows.map((r) => ({ id: r.id, guestId: r.guestId, remaining: r.remaining, expiresAt: r.expiresAt as Date }));
  }

  async expireLot(item: ExpirationPlan): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Só expira se o saldo do lote ainda for o que foi lido (um resgate concorrente o teria mudado).
        const claimed = await tx.pointsTransaction.updateMany({
          where: { id: item.lotId, remaining: item.points },
          data: { remaining: 0 },
        });
        if (claimed.count === 0) return false;
        await tx.pointsTransaction.create({
          data: {
            guestId: item.guestId,
            type: 'EXPIRE',
            points: -item.points,
            remaining: 0,
            idempotencyKey: `expire:${item.lotId}`,
            note: 'Pontos vencidos',
          },
        });
        return true;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false; // já expirado
      throw e;
    }
  }

  async findTierReviewCandidates(now: Date) {
    const rows = await this.prisma.guest.findMany({
      where: {
        deletedAt: null,
        tier: { rank: { gt: 0 } },
        OR: [{ tierValidUntil: null }, { tierValidUntil: { lte: now } }],
      },
      select: { id: true, tier: { select: { rank: true } } },
    });
    return rows.map((r) => ({ guestId: r.id, tierRank: r.tier.rank }));
  }

  async qualifyingPointsSince(guestId: string, since: Date): Promise<number> {
    const r = await this.prisma.pointsTransaction.aggregate({
      where: { guestId, createdAt: { gte: since } },
      _sum: { qualifyingPts: true },
    });
    return r._sum.qualifyingPts ?? 0;
  }

  async applyTierReview(guestId: string, newRank: number, validUntil: Date | null, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Mesma trava do check-out: não disputa com um crédito que acabou de renovar o nível.
      await tx.$queryRaw`SELECT id FROM "Guest" WHERE id = ${guestId} FOR UPDATE`;
      const g = await tx.guest.findUnique({ where: { id: guestId }, select: { tierValidUntil: true } });
      if (!g || (g.tierValidUntil && g.tierValidUntil > now)) return false;
      await tx.guest.update({
        where: { id: guestId },
        data: { tier: { connect: { rank: newRank } }, tierValidUntil: validUntil },
      });
      return true;
    });
  }

  async saveNotices(notices: NoticePlan[]): Promise<number> {
    if (notices.length === 0) return 0;
    const r = await this.prisma.expiryNotice.createMany({ data: notices, skipDuplicates: true });
    return r.count;
  }
}
