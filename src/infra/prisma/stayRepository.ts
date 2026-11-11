import { Prisma, type BookingChannel, type PrismaClient } from '@prisma/client';
import {
  DuplicateStayError,
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
    // Sem identificador externo, o mesmo hóspede com as mesmas datas conta como lançamento repetido.
    if (!s.externalRef) {
      const dup = await this.prisma.stay.findFirst({
        where: { guestId: s.guestId, checkIn: s.checkIn, checkOut: s.checkOut, pmsReservationId: null },
        select: { id: true },
      });
      if (dup) throw new DuplicateStayError();
    }
    try {
      await this.prisma.stay.create({
        data: {
          id: s.id,
          guestId: s.guestId,
          source: 'MANUAL',
          pmsReservationId: s.externalRef ? `manual:${s.externalRef}` : undefined,
          channel: s.channel as BookingChannel,
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
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2003') throw new GuestNotFoundError(); // chave estrangeira: hóspede inexistente
        if (e.code === 'P2002') throw new DuplicateStayError(); // identificador externo repetido
      }
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
        checkOut: s.checkOut,
        pointsProcessedAt: s.pointsProcessedAt,
      },
      charges: s.charges.map((c) => ({ category: c.category, amount: Number(c.amount) })),
      guest: {
        id: s.guest.id,
        tierRank: s.guest.tier.rank,
        tierValidUntil: s.guest.tierValidUntil,
        referredById: s.guest.referredById,
        welcomeBonusPending: s.guest.welcomeBonusPending,
      },
      hasPriorEarning: prior > 0,
    };
  }

  async qualifyingPointsSince(guestId: string, since: Date): Promise<number> {
    const r = await this.prisma.pointsTransaction.aggregate({
      where: { guestId, createdAt: { gte: since } },
      _sum: { qualifyingPts: true },
    });
    return r._sum.qualifyingPts ?? 0;
  }

  async commitCheckout(c: CheckoutCommit): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Trava o hóspede: check-outs simultâneos do mesmo hóspede passam a ser um de cada vez.
        await tx.$queryRaw`SELECT id FROM "Guest" WHERE id = ${c.guestId} FOR UPDATE`;

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
              qualifyingPts: t.qualifyingPts,
              expiresAt: t.expiresAt,
              stayId: t.stayId,
              idempotencyKey: t.idempotencyKey,
              note: t.note,
            })),
          });
        }

        // Nível nunca regride por causa de outro check-out concorrente (lido sob a trava).
        const current = await tx.guest.findUnique({
          where: { id: c.guestId },
          select: { tier: { select: { rank: true } } },
        });
        const data: Prisma.GuestUpdateInput = {};
        if (c.newTierRank !== undefined) {
          if (current && c.newTierRank > current.tier.rank) {
            data.tier = { connect: { rank: c.newTierRank } };
            data.tierValidUntil = c.tierValidUntil;
          }
        } else if (c.tierValidUntil) {
          data.tierValidUntil = c.tierValidUntil;
        }
        if (c.clearWelcomePending) data.welcomeBonusPending = 0;
        if (Object.keys(data).length > 0) await tx.guest.update({ where: { id: c.guestId }, data });
      });
    } catch (e) {
      // Chave de idempotência repetida: outro processamento gravou antes. O chamador recarrega e recalcula.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new StayAlreadyProcessedError();
      }
      throw e;
    }
  }
}
