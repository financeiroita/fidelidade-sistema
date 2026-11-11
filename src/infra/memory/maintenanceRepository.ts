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
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async loadActiveLots(): Promise<LotRow[]> {
    return this.stays.transactions
      .filter((t) => t.remaining > 0 && t.expiresAt)
      .map((t) => ({
        id: t.id,
        guestId: t.guestId,
        remaining: t.remaining,
        expiresAt: t.expiresAt as Date,
        guestActive: true,
      }));
  }

  async expireLot(item: ExpirationPlan): Promise<boolean> {
    const lot = this.stays.transactions.find((t) => t.id === item.lotId);
    if (!lot || lot.remaining !== item.points) return false;
    const key = `expire:${item.lotId}`;
    if (this.stays.transactions.some((t) => t.idempotencyKey === key)) return false;
    lot.remaining = 0;
    // Igual ao banco: o lançamento de expiração não tem validade nem conta para o nível.
    this.stays.transactions.push({
      id: `expire-${item.lotId}`,
      guestId: item.guestId,
      type: 'EXPIRE',
      points: -item.points,
      qualifyingPts: 0,
      remaining: 0,
      idempotencyKey: key,
      createdAt: this.clock(),
    });
    return true;
  }

  async findTierReviewCandidates(now: Date) {
    return this.guests.guests
      .map((g) => ({ guestId: g.id, t: this.stays.tiers.get(g.id) }))
      .filter(({ t }) => t && t.rank > 0 && (!t.validUntil || t.validUntil <= now))
      .map(({ guestId }) => ({ guestId }));
  }

  async reviewTier(
    guestId: string,
    now: Date,
    since: Date,
    decide: (qualifyingPts: number) => { newRank: number; validUntil: Date | null },
  ) {
    const t = this.stays.tiers.get(guestId);
    if (!t || t.rank === 0 || (t.validUntil && t.validUntil > now)) return null;
    const plan = decide(await this.stays.qualifyingPointsSince(guestId, since));
    this.stays.tiers.set(guestId, { rank: plan.newRank, validUntil: plan.validUntil ?? undefined });
    return { previousRank: t.rank, newRank: plan.newRank };
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
