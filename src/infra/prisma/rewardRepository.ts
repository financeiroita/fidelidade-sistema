import { Prisma, type PrismaClient } from '@prisma/client';
import {
  RequestIdReusedError,
  type NewReward,
  type RedemptionRow,
  type RedemptionStatus,
  type RewardGuest,
  type RewardRepository,
  type RewardRow,
  type RewardType,
  type RewardUow,
  type StatementRow,
} from '../../application/ports';

type Tx = Prisma.TransactionClient;

const toReward = (r: {
  id: string;
  name: string;
  type: string;
  pointsCost: number;
  description: string | null;
  minTierRank: number;
  active: boolean;
}): RewardRow => ({
  id: r.id,
  name: r.name,
  type: r.type as RewardType,
  pointsCost: r.pointsCost,
  description: r.description ?? undefined,
  minTierRank: r.minTierRank,
  active: r.active,
});

const redemptionInclude = { lots: true } as const;
const toRedemption = (r: {
  id: string;
  guestId: string;
  rewardId: string;
  points: number;
  code: string;
  requestId: string;
  status: string;
  stayId: string | null;
  lots: Array<{ lotId: string; points: number }>;
}): RedemptionRow => ({
  id: r.id,
  guestId: r.guestId,
  rewardId: r.rewardId,
  points: r.points,
  code: r.code,
  requestId: r.requestId,
  status: r.status as RedemptionStatus,
  stayId: r.stayId,
  lots: r.lots.map((l) => ({ lotId: l.lotId, points: l.points })),
});

function makeUow(tx: Tx): RewardUow {
  return {
    async getGuest(guestId): Promise<RewardGuest | null> {
      const g = await tx.guest.findUnique({
        where: { id: guestId },
        select: { id: true, tierValidUntil: true, deletedAt: true, tier: { select: { rank: true } } },
      });
      return g ? { id: g.id, tierRank: g.tier.rank, tierValidUntil: g.tierValidUntil, active: g.deletedAt === null } : null;
    },
    async getReward(rewardId) {
      const r = await tx.reward.findUnique({ where: { id: rewardId } });
      return r ? toReward(r) : null;
    },
    async getRedemptionByRequest(requestId) {
      const r = await tx.redemption.findUnique({ where: { requestId }, include: redemptionInclude });
      return r ? toRedemption(r) : null;
    },
    async getRedemption(id) {
      const r = await tx.redemption.findUnique({ where: { id }, include: redemptionInclude });
      return r ? toRedemption(r) : null;
    },
    async loadUsableLots(guestId, now) {
      const rows = await tx.pointsTransaction.findMany({
        where: { guestId, remaining: { gt: 0 }, expiresAt: { gt: now } },
        select: { id: true, remaining: true, expiresAt: true },
      });
      return rows.map((r) => ({ id: r.id, remaining: r.remaining, expiresAt: r.expiresAt as Date }));
    },
    async createRedemption(r, rewardName) {
      await tx.redemption.create({
        data: {
          id: r.id,
          guestId: r.guestId,
          rewardId: r.rewardId,
          points: r.points,
          status: 'PENDING',
          code: r.code,
          requestId: r.requestId,
          lots: { create: r.lots.map((l) => ({ lotId: l.lotId, points: l.points })) },
        },
      });
      for (const l of r.lots) {
        // Garantia extra: o lote ainda precisa ter o saldo que foi lido (a trava do hóspede já serializa).
        const upd = await tx.pointsTransaction.updateMany({
          where: { id: l.lotId, remaining: { gte: l.points } },
          data: { remaining: { decrement: l.points } },
        });
        if (upd.count !== 1) throw new Error('Saldo do lote mudou durante o resgate');
      }
      await tx.pointsTransaction.create({
        data: {
          guestId: r.guestId,
          type: 'REDEEM',
          points: -r.points,
          remaining: 0,
          redemptionId: r.id,
          idempotencyKey: `redeem:${r.id}`,
          note: `Resgate: ${rewardName}`,
        },
      });
    },
    async setStatus(id, status, extra) {
      await tx.redemption.update({
        where: { id },
        data: { status, stayId: extra?.stayId, usedAt: extra?.usedAt },
      });
    },
    async cancelRedemption(r) {
      for (const l of r.lots) {
        await tx.pointsTransaction.update({ where: { id: l.lotId }, data: { remaining: { increment: l.points } } });
      }
      await tx.pointsTransaction.create({
        data: {
          guestId: r.guestId,
          type: 'REVERSAL',
          points: r.points,
          remaining: 0,
          redemptionId: r.id,
          idempotencyKey: `redeem-cancel:${r.id}`,
          note: 'Resgate cancelado: pontos devolvidos',
        },
      });
      await tx.redemption.update({ where: { id: r.id }, data: { status: 'CANCELLED' } });
    },
  };
}

export class PrismaRewardRepository implements RewardRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createReward(r: NewReward): Promise<RewardRow> {
    return toReward(await this.prisma.reward.create({ data: r }));
  }

  async listActiveRewards(): Promise<RewardRow[]> {
    const rows = await this.prisma.reward.findMany({ where: { active: true }, orderBy: { pointsCost: 'asc' } });
    return rows.map(toReward);
  }

  async findRedemptionGuest(redemptionId: string) {
    const r = await this.prisma.redemption.findUnique({ where: { id: redemptionId }, select: { guestId: true } });
    return r?.guestId ?? null;
  }

  async inGuestTransaction<T>(guestId: string, fn: (uow: RewardUow) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Mesma ordem de trava de check-out e rotina noturna: primeiro o hóspede, depois os lotes.
        await tx.$queryRaw`SELECT id FROM "Guest" WHERE id = ${guestId} FOR UPDATE`;
        return fn(makeUow(tx));
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        if (String(e.meta?.target ?? '').includes('requestId')) throw new RequestIdReusedError();
      }
      throw e;
    }
  }

  async getBalance(guestId: string, now: Date) {
    const g = await this.prisma.guest.findUnique({ where: { id: guestId }, select: { welcomeBonusPending: true } });
    if (!g) return null;
    const [usable, ledger] = await Promise.all([
      this.prisma.pointsTransaction.aggregate({
        where: { guestId, remaining: { gt: 0 }, expiresAt: { gt: now } },
        _sum: { remaining: true },
      }),
      this.prisma.pointsTransaction.aggregate({ where: { guestId }, _sum: { points: true } }),
    ]);
    return {
      available: usable._sum.remaining ?? 0,
      ledger: ledger._sum.points ?? 0,
      pendingWelcome: g.welcomeBonusPending,
    };
  }

  async getStatement(guestId: string, limit: number): Promise<StatementRow[]> {
    const rows = await this.prisma.pointsTransaction.findMany({
      where: { guestId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { createdAt: true, type: true, points: true, note: true },
    });
    return rows.map((r) => ({ at: r.createdAt, type: r.type, points: r.points, note: r.note }));
  }
}
