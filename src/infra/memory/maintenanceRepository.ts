import type { MaintenanceRepository } from '../../application/ports';
import type { ExpirationPlan, LotRow, NoticePlan } from '../../domain/points/maintenance';
import type { InMemoryGuestRepository } from './guestRepository';
import type { InMemoryStayRepository } from './stayRepository';

/** Implementação em memória, usada nos testes. Opera sobre os dados do repositório de estadias. */
export class InMemoryMaintenanceRepository implements MaintenanceRepository {
  notices: NoticePlan[] = [];

  constructor(
    private readonly stays: InMemoryStayRepository,
    private readonly guests: InMemoryGuestRepository,
  ) {}

  async loadActiveLots(): Promise<LotRow[]> {
    return this.stays.transactions
      .filter((t) => t.remaining > 0 && t.expiresAt)
      .map((t) => ({ id: t.id, guestId: t.guestId, remaining: t.remaining, expiresAt: t.expiresAt }));
  }

  async expireLot(item: ExpirationPlan): Promise<boolean> {
    const lot = this.stays.transactions.find((t) => t.id === item.lotId);
    if (!lot || lot.remaining !== item.points) return false;
    const key = `expire:${item.lotId}`;
    if (this.stays.transactions.some((t) => t.idempotencyKey === key)) return false;
    lot.remaining = 0;
    this.stays.transactions.push({
      id: `expire-${item.lotId}`,
      guestId: item.guestId,
      type: 'EXPIRE',
      points: -item.points,
      qualifyingPts: 0,
      remaining: 0,
      expiresAt: lot.expiresAt,
      idempotencyKey: key,
      createdAt: new Date(),
    });
    return true;
  }

  async findTierReviewCandidates(now: Date) {
    return this.guests.guests
      .map((g) => ({ guestId: g.id, t: this.stays.tiers.get(g.id) }))
      .filter(({ t }) => t && t.rank > 0 && (!t.validUntil || t.validUntil <= now))
      .map(({ guestId, t }) => ({ guestId, tierRank: t!.rank }));
  }

  qualifyingPointsSince(guestId: string, since: Date) {
    return this.stays.qualifyingPointsSince(guestId, since);
  }

  async applyTierReview(guestId: string, newRank: number, validUntil: Date | null, now: Date) {
    const t = this.stays.tiers.get(guestId);
    if (t?.validUntil && t.validUntil > now) return false;
    this.stays.tiers.set(guestId, { rank: newRank, validUntil: validUntil ?? undefined });
    return true;
  }

  async saveNotices(notices: NoticePlan[]) {
    let created = 0;
    for (const n of notices) {
      const dup = this.notices.some(
        (o) => o.guestId === n.guestId && o.windowDays === n.windowDays && o.expiresOn.getTime() === n.expiresOn.getTime(),
      );
      if (!dup) {
        this.notices.push(n);
        created++;
      }
    }
    return created;
  }
}
