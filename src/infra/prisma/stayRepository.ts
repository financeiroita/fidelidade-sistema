import { Prisma, type PrismaClient } from '@prisma/client';
import {
  GuestNotFoundError,
  StayAlreadyProcessedError,
  type CheckoutCommit,
  type CheckoutData,
  type NewStay,
  type StayRepository,
  type StayStatus,
} from '../../application/ports';

export class PrismaStayRepository implements StayRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createStay(s: NewStay): Promise<void> {
    try {
      await this.prisma.stay.create({
        data: {
          id: s.id,
          guestId: s.guestId,
          source: 'MANUAL',
          channel: s.channel as never,
          status: 'CHECKED_IN',
          checkIn: s.checkIn,
          checkOut: s.checkOut,
          nights: s.nights,
          roomType: s.roomType,
          adults: s.adults,
          children: s.children,
          isDirect: s.isDirect,
          charges: {
            create: s.charges.map((c) => ({ category: c.category, amount: c.amount, description: c.description })),
          },
        },
      });
    } catch (e) {
      // Chave estrangeira: hóspede inexistente.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') throw new GuestNotFoundError();
      throw e;
    }
  }

  async loadCheckout(stayId: string): Promise<CheckoutData | null> {
    const s = await this.prisma.stay.findUnique({
      where: { id: stayId },
      include: { charges: true, guest: { include: { tier: true } } },
    });
    if (!s) return null;
    const prior = await this.prisma.pointsTransaction.count({
      where: { guestId: s.guestId, type: { in: ['EARN_STAY', 'EARN_CHARGE'] } },
    });
    return {
      stay: {
        id: s.id,
        guestId: s.guestId,
        status: s.status as StayStatus,
        isDirect: s.isDirect,
        pointsProcessedAt: s.pointsProcessedAt,
      },
      charges: s.charges.map((c) => ({ category: c.category, amount: Number(c.amount) })),
      guest: {
        id: s.guest.id,
        tierRank: s.guest.tier.rank,
        referredById: s.guest.referredById,
        welcomeBonusPending: s.guest.welcomeBonusPending,
      },
      hasPriorEarning: prior > 0,
    };
  }

  async qualifyingPointsSince(guestId: string, since: Date): Promise<number> {
    const r = await this.prisma.pointsTransaction.aggregate({
      where: { guestId, qualifying: true, createdAt: { gte: since } },
      _sum: { points: true },
    });
    return r._sum.points ?? 0;
  }

  async commitCheckout(c: CheckoutCommit): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Só um processamento vence: a condição pointsProcessedAt = null é checada no próprio UPDATE.
        const claimed = await tx.stay.updateMany({
          where: { id: c.stayId, pointsProcessedAt: null },
          data: { status: 'CHECKED_OUT', pointsProcessedAt: c.processedAt },
        });
        if (claimed.count === 0) throw new StayAlreadyProcessedError();

        if (c.transactions.length > 0) {
          await tx.pointsTransaction.createMany({
            data: c.transactions.map((t) => ({
              guestId: t.guestId,
              type: t.type,
              points: t.points,
              remaining: t.points,
              qualifying: t.qualifying,
              expiresAt: t.expiresAt,
              stayId: t.stayId,
              idempotencyKey: t.idempotencyKey,
              note: t.note,
            })),
          });
        }
        await tx.guest.update({
          where: { id: c.guestId },
          data: {
            ...(c.newTierRank !== undefined
              ? { tier: { connect: { rank: c.newTierRank } }, tierValidUntil: c.tierValidUntil }
              : {}),
            ...(c.clearWelcomePending ? { welcomeBonusPending: 0 } : {}),
          },
        });
      });
    } catch (e) {
      // Chave de idempotência repetida: o mesmo crédito já foi gravado por outro processamento.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new StayAlreadyProcessedError();
      }
      throw e;
    }
  }
}
