import { randomUUID } from 'node:crypto';
import type {
  NewReward,
  RedemptionRow,
  RewardPatch,
  RewardRepository,
  RewardRow,
  RewardUow,
  StatementRow,
} from '../../application/ports';
import type { InMemoryGuestRepository } from './guestRepository';
import type { InMemoryStayRepository } from './stayRepository';

/**
 * Implementação em memória, usada nos testes. Um fluxo por hóspede de cada vez (como a trava do banco).
 * Sem desfazer: os casos de uso validam tudo antes de gravar.
 */
export class InMemoryRewardRepository implements RewardRepository {
  rewards = new Map<string, RewardRow>();
  redemptions = new Map<string, RedemptionRow>();
  private chains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly stays: InMemoryStayRepository,
    private readonly guests: InMemoryGuestRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async createReward(r: NewReward) {
    const row: RewardRow = { id: randomUUID(), active: true, ...r };
    this.rewards.set(row.id, row);
    return row;
  }

  async updateReward(id: string, patch: RewardPatch) {
    const cur = this.rewards.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.rewards.set(id, next);
    return next;
  }

  async listActiveRewards() {
    return [...this.rewards.values()].filter((r) => r.active).sort((a, b) => a.pointsCost - b.pointsCost);
  }

  async findRedemptionGuest(id: string) {
    return this.redemptions.get(id)?.guestId ?? null;
  }

  inGuestTransaction<T>(guestId: string, fn: (uow: RewardUow) => Promise<T>): Promise<T> {
    const prev = this.chains.get(guestId) ?? Promise.resolve();
    const run = prev.then(() => fn(this.uow()));
    this.chains.set(
      guestId,
      run.catch(() => undefined),
    );
    return run;
  }

  async getBalance(guestId: string, now: Date) {
    const g = this.guests.guests.find((x) => x.id === guestId);
    if (!g) return null;
    const txs = this.stays.transactions.filter((t) => t.guestId === guestId);
    return {
      available: txs
        .filter((t) => t.remaining > 0 && t.expiresAt && t.expiresAt > now)
        .reduce((s, t) => s + t.remaining, 0),
      ledger: txs.reduce((s, t) => s + t.points, 0),
      pendingWelcome: g.welcomeBonusPending,
    };
  }

  async getStatement(guestId: string, limit: number): Promise<StatementRow[]> {
    // Mais recente primeiro; lançamentos do mesmo instante saem na ordem inversa da gravação.
    return this.stays.transactions
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.guestId === guestId)
      .sort((a, b) => b.t.createdAt.getTime() - a.t.createdAt.getTime() || b.i - a.i)
      .slice(0, limit)
      .map(({ t }) => ({ at: t.createdAt, type: t.type, points: t.points, note: t.note ?? null }));
  }

  private uow(): RewardUow {
    const txs = this.stays.transactions;
    return {
      getGuest: async (id) => {
        const g = this.guests.guests.find((x) => x.id === id);
        const t = this.stays.tiers.get(id);
        return g ? { id, tierRank: t?.rank ?? 0, tierValidUntil: t?.validUntil ?? null, active: !g.deletedAt } : null;
      },
      getReward: async (id) => this.rewards.get(id) ?? null,
      getRedemptionByRequest: async (requestId) =>
        [...this.redemptions.values()].find((r) => r.requestId === requestId) ?? null,
      getRedemption: async (id) => this.redemptions.get(id) ?? null,
      loadUsableLots: async (guestId, now) =>
        txs
          .filter((t) => t.guestId === guestId && t.remaining > 0 && t.expiresAt && t.expiresAt > now)
          .map((t) => ({ id: t.id, remaining: t.remaining, expiresAt: t.expiresAt as Date })),
      qualifyingPointsSince: (guestId, since) => this.stays.qualifyingPointsSince(guestId, since),
      createRedemption: async (r, rewardName, now) => {
        // Valida tudo antes de gravar: a memória não desfaz escritas parciais como o banco.
        for (const l of r.lots) {
          const lot = txs.find((t) => t.id === l.lotId);
          if (!lot || lot.remaining < l.points) throw new Error('Saldo do lote mudou durante o resgate');
        }
        for (const l of r.lots) txs.find((t) => t.id === l.lotId)!.remaining -= l.points;
        this.redemptions.set(r.id, { ...r, status: 'PENDING', stayId: null });
        txs.push({
          id: randomUUID(),
          guestId: r.guestId,
          type: 'REDEEM',
          points: -r.points,
          qualifyingPts: 0,
          remaining: 0,
          redemptionId: r.id,
          idempotencyKey: `redeem:${r.id}`,
          note: `Resgate: ${rewardName}`,
          createdAt: now, // relógio do caso de uso, igual ao banco
        });
      },
      setStatus: async (id, status, extra) => {
        const r = this.redemptions.get(id);
        if (r) this.redemptions.set(id, { ...r, status, stayId: extra?.stayId ?? r.stayId });
      },
      cancelRedemption: async (r, now) => {
        const lapsed: Array<{ lotId: string; points: number }> = [];
        for (const l of r.lots) {
          const lot = txs.find((t) => t.id === l.lotId);
          if (lot?.expiresAt && lot.expiresAt > now) lot.remaining += l.points;
          else lapsed.push(l);
        }
        txs.push({
          id: randomUUID(),
          guestId: r.guestId,
          type: 'REVERSAL',
          points: r.points,
          qualifyingPts: 0,
          remaining: 0,
          redemptionId: r.id,
          idempotencyKey: `redeem-cancel:${r.id}`,
          note: 'Resgate cancelado: pontos devolvidos',
          createdAt: now, // relógio do caso de uso, igual ao banco
        });
        for (const l of lapsed) {
          txs.push({
            id: randomUUID(),
            guestId: r.guestId,
            type: 'EXPIRE',
            points: -l.points,
            qualifyingPts: 0,
            remaining: 0,
            redemptionId: r.id,
            idempotencyKey: `redeem-cancel-expire:${r.id}:${l.lotId}`,
            note: 'Pontos vencidos (resgate cancelado após o vencimento)',
            createdAt: now, // relógio do caso de uso, igual ao banco
          });
        }
        this.redemptions.set(r.id, { ...r, status: 'CANCELLED' });
      },
      stayBelongsToGuest: async (stayId, guestId) => this.stays.stays.get(stayId)?.guestId === guestId,
    };
  }
}
