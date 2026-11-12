import { randomUUID } from 'node:crypto';
import {
  DuplicateStayError,
  GuestNotFoundError,
  StayAlreadyProcessedError,
  StayNotEligibleError,
  StayOutOfPeriodError,
  type CheckoutCommit,
  type CheckoutData,
  type MemberSinceRule,
  type NewPointsTx,
  type NewStay,
  type StayRepository,
  type StayStatus,
} from '../../application/ports';
import { overlapEnd } from '../prisma/stayRepository';
import type { InMemoryGuestRepository } from './guestRepository';

interface StoredStay extends NewStay {
  status: StayStatus;
  pointsProcessedAt: Date | null;
}

export type StoredTx = Omit<NewPointsTx, 'type' | 'expiresAt'> & {
  id: string;
  type: NewPointsTx['type'] | 'EXPIRE' | 'REDEEM' | 'REVERSAL';
  redemptionId?: string;
  /** Só créditos têm validade; o lançamento de expiração não. */
  expiresAt?: Date;
  remaining: number;
  createdAt: Date;
};

/** Implementação em memória, usada nos testes. Lê os hóspedes do repositório de hóspedes. */
export class InMemoryStayRepository implements StayRepository {
  stays = new Map<string, StoredStay>();
  transactions: StoredTx[] = [];
  tiers = new Map<string, { rank: number; validUntil?: Date }>();

  constructor(private readonly guests: InMemoryGuestRepository) {}

  async createStay(stay: NewStay, allowed: MemberSinceRule) {
    const guest = this.guests.active(stay.guestId);
    if (!guest) throw new GuestNotFoundError();
    if (!allowed(guest.memberSince)) throw new StayOutOfPeriodError('A estadia terminou antes do cadastro do hóspede.');
    const others = [...this.stays.values()];
    const end = overlapEnd(stay.checkIn, stay.checkOut);
    // Igual ao banco: número repetido é duplicata; período sobreposto também, salvo se as DUAS têm número.
    const sameRef = !!stay.externalRef && others.some((o) => o.externalRef === stay.externalRef);
    const overlap = others.some(
      (o) =>
        o.guestId === stay.guestId &&
        (!stay.externalRef || !o.externalRef) &&
        o.status !== 'CANCELLED' &&
        o.status !== 'NO_SHOW' &&
        o.checkIn < end &&
        overlapEnd(o.checkIn, o.checkOut) > stay.checkIn,
    );
    if (sameRef || overlap) throw new DuplicateStayError();
    this.stays.set(stay.id, { ...stay, status: 'CHECKED_IN', pointsProcessedAt: null });
  }

  async loadCheckout(stayId: string): Promise<CheckoutData | null> {
    const s = this.stays.get(stayId);
    const g = s && this.guests.guests.find((x) => x.id === s.guestId);
    if (!s || !g) return null;
    return {
      stay: {
        id: s.id,
        guestId: s.guestId,
        status: s.status,
        isDirect: s.isDirect,
        checkOut: s.checkOut,
        pointsProcessedAt: s.pointsProcessedAt,
      },
      charges: s.charges.map((c) => ({ category: c.category, amount: c.amount })),
      guest: {
        id: g.id,
        tierRank: this.tiers.get(g.id)?.rank ?? 0,
        tierValidUntil: this.tiers.get(g.id)?.validUntil ?? null,
        referredById: g.referredById ?? null,
        welcomeBonusPending: g.welcomeBonusPending,
        active: !g.deletedAt,
        referrerActive: !!g.referredById && this.guests.active(g.referredById) !== null,
      },
      hasPriorEarning: this.transactions.some(
        (t) => t.guestId === s.guestId && (t.type === 'EARN_STAY' || t.type === 'EARN_CHARGE'),
      ),
    };
  }

  async qualifyingPointsSince(guestId: string, since: Date) {
    return this.transactions
      .filter((t) => t.guestId === guestId && t.createdAt >= since)
      .reduce((s, t) => s + t.qualifyingPts, 0);
  }

  async commitCheckout(c: CheckoutCommit): Promise<{ tierRank: number; tierValidUntil: Date | null }> {
    if (!this.guests.active(c.guestId)) throw new StayNotEligibleError('Hóspede excluído do programa.');
    const s = this.stays.get(c.stayId);
    if (!s || s.pointsProcessedAt) throw new StayAlreadyProcessedError();
    const keys = new Set(this.transactions.map((t) => t.idempotencyKey));
    if (c.transactions.some((t) => keys.has(t.idempotencyKey))) throw new StayAlreadyProcessedError();
    for (const t of c.transactions) {
      // Igual ao banco: bônus para quem indicou só se ele ainda estiver ativo na hora de gravar.
      if (t.guestId !== c.guestId && !this.guests.active(t.guestId)) continue;
      this.transactions.push({ ...t, id: randomUUID(), remaining: t.points, createdAt: c.processedAt });
    }
    s.status = 'CHECKED_OUT';
    s.pointsProcessedAt = c.processedAt;
    const current = this.tiers.get(c.guestId) ?? { rank: 0 };
    const d = c.decideTier(await this.qualifyingPointsSince(c.guestId, c.tierWindowStart), current.rank);
    const rank = d.newTierRank !== undefined && d.newTierRank > current.rank ? d.newTierRank : current.rank;
    const validUntil = d.tierValidUntil ?? current.validUntil;
    if (rank !== current.rank || d.tierValidUntil) this.tiers.set(c.guestId, { rank, validUntil });
    if (c.clearWelcomePending) {
      const g = this.guests.guests.find((x) => x.id === c.guestId);
      if (g) g.welcomeBonusPending = 0;
    }
    return { tierRank: rank, tierValidUntil: validUntil ?? null };
  }

  balance(guestId: string) {
    return this.transactions.filter((t) => t.guestId === guestId).reduce((s, t) => s + t.points, 0);
  }
}
