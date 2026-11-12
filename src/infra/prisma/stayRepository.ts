import { Prisma, type BookingChannel, type PrismaClient } from '@prisma/client';
import {
  DuplicateStayError,
  GuestNotFoundError,
  StayAlreadyProcessedError,
  StayOutOfPeriodError,
  type CheckoutCommit,
  type CheckoutData,
  type MemberSinceRule,
  type NewStay,
  type StayRepository,
  type StayStatus,
} from '../../application/ports';

const DAY = 86_400_000;
/** Fim do período ocupado: day use (entrada = saída) ocupa o próprio dia. */
export const overlapEnd = (checkIn: Date, checkOut: Date) =>
  checkOut.getTime() > checkIn.getTime() ? checkOut : new Date(checkIn.getTime() + DAY);

export class PrismaStayRepository implements StayRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createStay(s: NewStay, allowed: MemberSinceRule): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Trava o hóspede: dois lançamentos simultâneos (clique duplo) passam um de cada vez.
        const rows = await tx.$queryRaw<Array<{ memberSince: Date }>>`SELECT "memberSince" FROM "Guest" WHERE id = ${s.guestId} AND "deletedAt" IS NULL FOR UPDATE`;
        if (rows.length === 0) throw new GuestNotFoundError();
        if (!allowed(rows[0].memberSince)) {
          throw new StayOutOfPeriodError('A estadia terminou antes do cadastro do hóspede.');
        }
        // Sem identificador externo, período sobreposto ao de outra estadia do hóspede = lançamento repetido.
        // (Day use, com entrada e saída no mesmo dia, ocupa aquele dia.)
        if (!s.externalRef) {
          const end = overlapEnd(s.checkIn, s.checkOut);
          const dup = await tx.stay.findFirst({
            where: {
              guestId: s.guestId,
              status: { notIn: ['CANCELLED', 'NO_SHOW'] },
              checkIn: { lt: end },
              OR: [{ checkOut: { gt: s.checkIn } }, { checkIn: s.checkIn }],
            },
            select: { id: true },
          });
          if (dup) throw new DuplicateStayError();
        }
        await tx.stay.create({
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
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') throw new DuplicateStayError(); // identificador externo repetido
      }
      throw e;
    }
  }

  async loadCheckout(stayId: string): Promise<CheckoutData | null> {
    const s = await this.prisma.stay.findUnique({
      where: { id: stayId },
      include: { charges: true, guest: { include: { tier: true, referredBy: { select: { deletedAt: true } } } } },
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
        active: s.guest.deletedAt === null,
        referrerActive: s.guest.referredBy?.deletedAt === null,
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

  async commitCheckout(c: CheckoutCommit): Promise<{ tierRank: number }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
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
              createdAt: c.processedAt, // relógio da aplicação, igual à janela do nível
            })),
          });
        }

        // Nível decidido sob a trava, com os pontos-base relidos (já com os desta estadia): dois
        // check-outs simultâneos do mesmo hóspede não perdem a subida, e o nível nunca regride aqui.
        const current = await tx.guest.findUniqueOrThrow({
          where: { id: c.guestId },
          select: { tier: { select: { rank: true } } },
        });
        const agg = await tx.pointsTransaction.aggregate({
          where: { guestId: c.guestId, createdAt: { gte: c.tierWindowStart } },
          _sum: { qualifyingPts: true },
        });
        const decision = c.decideTier(agg._sum.qualifyingPts ?? 0, current.tier.rank);
        const data: Prisma.GuestUpdateInput = {};
        let tierRank = current.tier.rank;
        if (decision.newTierRank !== undefined && decision.newTierRank > current.tier.rank) {
          data.tier = { connect: { rank: decision.newTierRank } };
          tierRank = decision.newTierRank;
        }
        if (decision.tierValidUntil) data.tierValidUntil = decision.tierValidUntil;
        if (c.clearWelcomePending) data.welcomeBonusPending = 0;
        if (Object.keys(data).length > 0) await tx.guest.update({ where: { id: c.guestId }, data });
        return { tierRank };
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
