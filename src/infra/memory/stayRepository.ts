import {
  DuplicateStayError,
  GuestNotFoundError,
  StayAlreadyProcessedError,
  type CheckoutCommit,
  type CheckoutData,
  type NewPointsTx,
  type NewStay,
  type StayRepository,
  type StayStatus,
} from '../../application/ports';
import type { InMemoryGuestRepository } from './guestRepository';

interface StoredStay extends NewStay {
  status: StayStatus;
  pointsProcessedAt: Date | null;
}

/** Implementação em memória, usada nos testes. Lê os hóspedes do repositório de hóspedes. */
export class InMemoryStayRepository implements StayRepository {
  stays = new Map<string, StoredStay>();
  transactions: Array<NewPointsTx & { createdAt: Date }> = [];
  tiers = new Map<string, { rank: number; validUntil?: Date }>();

  constructor(private readonly guests: InMemoryGuestRepository) {}

  async createStay(stay: NewStay) {
    if (!this.guests.guests.some((g) => g.id === stay.guestId)) throw new GuestNotFoundError();
    const others = [...this.stays.values()];
    const dup = stay.externalRef
      ? others.some((o) => o.externalRef === stay.externalRef)
      : others.some(
          (o) =>
            !o.externalRef &&
            o.guestId === stay.guestId &&
            o.checkIn.getTime() === stay.checkIn.getTime() &&
            o.checkOut.getTime() === stay.checkOut.getTime(),
        );
    if (dup) throw new DuplicateStayError();
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
        referredById: g.referredById ?? null,
        welcomeBonusPending: g.welcomeBonusPending,
      },
      hasPriorEarning: this.transactions.some(
        (t) => t.guestId === s.guestId && (t.type === 'EARN_STAY' || t.type === 'EARN_CHARGE'),
      ),
    };
  }

  async qualifyingPointsSince(guestId: string, since: Date) {
    return this.transactions
      .filter((t) => t.guestId === guestId && t.qualifying && t.createdAt >= since)
      .reduce((s, t) => s + t.points, 0);
  }

  async commitCheckout(c: CheckoutCommit) {
    const s = this.stays.get(c.stayId);
    if (!s || s.pointsProcessedAt) throw new StayAlreadyProcessedError();
    const keys = new Set(this.transactions.map((t) => t.idempotencyKey));
    if (c.transactions.some((t) => keys.has(t.idempotencyKey))) throw new StayAlreadyProcessedError();
    for (const t of c.transactions) this.transactions.push({ ...t, createdAt: c.processedAt });
    s.status = 'CHECKED_OUT';
    s.pointsProcessedAt = c.processedAt;
    const current = this.tiers.get(c.guestId)?.rank ?? 0;
    if (c.newTierRank !== undefined && c.newTierRank > current) {
      this.tiers.set(c.guestId, { rank: c.newTierRank, validUntil: c.tierValidUntil });
    } else if (c.newTierRank === undefined && c.tierValidUntil) {
      this.tiers.set(c.guestId, { rank: current, validUntil: c.tierValidUntil });
    }
    if (c.clearWelcomePending) {
      const g = this.guests.guests.find((x) => x.id === c.guestId);
      if (g) g.welcomeBonusPending = 0;
    }
  }

  balance(guestId: string) {
    return this.transactions.filter((t) => t.guestId === guestId).reduce((s, t) => s + t.points, 0);
  }
}
