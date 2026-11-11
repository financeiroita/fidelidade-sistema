import { Prisma, type PrismaClient } from '@prisma/client';
import type { MaintenanceRepository } from '../../application/ports';
import type { ExpirationPlan, LotRow, NoticePlan } from '../../domain/points/maintenance';

export class PrismaMaintenanceRepository implements MaintenanceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async loadActiveLots(): Promise<LotRow[]> {
    const rows = await this.prisma.pointsTransaction.findMany({
      where: { remaining: { gt: 0 }, expiresAt: { not: null } },
      select: { id: true, guestId: true, remaining: true, expiresAt: true, guest: { select: { deletedAt: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      guestId: r.guestId,
      remaining: r.remaining,
      expiresAt: r.expiresAt as Date,
      guestActive: r.guest.deletedAt === null,
    }));
  }

  async expireLot(item: ExpirationPlan): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Mesma ordem de trava de todos os fluxos (check-out, resgate futuro): primeiro o hóspede,
        // depois os lotes. Evita impasse (deadlock) entre processos.
        await tx.$queryRaw`SELECT id FROM "Guest" WHERE id = ${item.guestId} FOR UPDATE`;
        // Só expira se o saldo do lote ainda for o que foi lido (um resgate teria mudado).
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
      select: { id: true },
    });
    return rows.map((r) => ({ guestId: r.id }));
  }

  async reviewTier(
    guestId: string,
    now: Date,
    since: Date,
    decide: (qualifyingPts: number) => { newRank: number; validUntil: Date | null },
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Mesma trava do check-out: não disputa com um crédito que acabou de renovar o nível.
      await tx.$queryRaw`SELECT id FROM "Guest" WHERE id = ${guestId} FOR UPDATE`;
      const g = await tx.guest.findUnique({
        where: { id: guestId },
        select: { tierValidUntil: true, deletedAt: true, tier: { select: { rank: true } } },
      });
      if (!g || g.deletedAt || g.tier.rank === 0 || (g.tierValidUntil && g.tierValidUntil > now)) return null;

      // Pontos lidos sob a trava: um check-out concorrente já está refletido.
      const agg = await tx.pointsTransaction.aggregate({
        where: { guestId, createdAt: { gte: since } },
        _sum: { qualifyingPts: true },
      });
      const plan = decide(agg._sum.qualifyingPts ?? 0);
      await tx.guest.update({
        where: { id: guestId },
        data: { tier: { connect: { rank: plan.newRank } }, tierValidUntil: plan.validUntil },
      });
      return { previousRank: g.tier.rank, newRank: plan.newRank };
    });
  }

  async saveNotices(notices: NoticePlan[]): Promise<number> {
    if (notices.length === 0) return 0;
    const r = await this.prisma.expiryNotice.createMany({ data: notices, skipDuplicates: true });
    return r.count;
  }
}
