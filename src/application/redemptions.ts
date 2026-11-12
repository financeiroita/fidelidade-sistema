import { randomInt, randomUUID } from 'node:crypto';
import { loyaltyConfig, type LoyaltyConfig } from '../config/loyalty';
import { consumeFifo } from '../domain/points/expiry';
import { addMonths } from '../domain/time';
import { effectiveTierRank } from '../domain/tiers/tier';
import type { RedeemInput, RewardInput } from '../domain/rewards/reward';
import {
  GuestNotFoundError,
  InsufficientPointsError,
  InvalidStayError,
  InvalidTransitionError,
  RedemptionNotFoundError,
  RewardNotAvailableError,
  TierTooLowError,
  RequestIdReusedError,
  type RedemptionRow,
  type RewardPatch,
  type RewardRepository,
  type RewardRow,
} from './ports';

export interface RewardDeps {
  repo: RewardRepository;
  config?: LoyaltyConfig;
  now?: () => Date;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => {
  let s = '';
  for (let i = 0; i < 10; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return `RES-${s}`;
};

export const createReward = (deps: RewardDeps, input: RewardInput): Promise<RewardRow> =>
  deps.repo.createReward(input);

export async function updateReward(deps: RewardDeps, id: string, patch: RewardPatch): Promise<RewardRow> {
  const r = await deps.repo.updateReward(id, patch);
  if (!r) throw new RewardNotAvailableError();
  return r;
}

export const listRewards = (deps: RewardDeps) => deps.repo.listActiveRewards();

/**
 * Resgata um prêmio: valida, escolhe os lotes que vencem primeiro (FIFO) e abate o saldo.
 * Idempotente por requestId. Tudo dentro da transação do hóspede.
 */
export async function redeem(
  deps: RewardDeps,
  input: RedeemInput,
): Promise<{ redemption: RedemptionRow; replay: boolean }> {
  const cfg = deps.config ?? loyaltyConfig;
  return deps.repo.inGuestTransaction(input.guestId, async (uow) => {
    // Lido já com o hóspede travado: um lote que venceu durante a espera não é consumido.
    const now = (deps.now ?? (() => new Date()))();
    const existing = await uow.getRedemptionByRequest(input.requestId);
    if (existing) {
      if (existing.guestId === input.guestId && existing.rewardId === input.rewardId) {
        return { redemption: existing, replay: true };
      }
      throw new RequestIdReusedError();
    }

    const guest = await uow.getGuest(input.guestId);
    if (!guest || !guest.active) throw new GuestNotFoundError();
    const reward = await uow.getReward(input.rewardId);
    if (!reward || !reward.active) throw new RewardNotAvailableError();

    // Nível com validade vencida (a rotina noturna ainda não rodou): vale o que os pontos-base da
    // janela garantem, lidos sob a trava. Mesma regra do check-out e da "Minha conta" (ADR 0016).
    if (reward.minTierRank > 0) {
      const qualifying = await uow.qualifyingPointsSince(guest.id, addMonths(now, -cfg.tierWindowMonths));
      const rank = effectiveTierRank(guest.tierRank, guest.tierValidUntil, qualifying, now, cfg);
      if (rank < reward.minTierRank) throw new TierTooLowError();
    }

    const lots = await uow.loadUsableLots(guest.id, now);
    const available = lots.reduce((s, l) => s + l.remaining, 0);
    if (available < reward.pointsCost) throw new InsufficientPointsError(available);

    const redemption: RedemptionRow = {
      id: randomUUID(),
      guestId: guest.id,
      rewardId: reward.id,
      points: reward.pointsCost,
      code: newCode(),
      requestId: input.requestId,
      lots: consumeFifo(lots, reward.pointsCost, now),
      status: 'PENDING',
      stayId: null,
    };
    await uow.createRedemption(redemption, reward.name, now);
    return { redemption, replay: false };
  });
}

export type RedemptionAction = 'confirm' | 'use' | 'cancel';

/**
 * Confirmar (PENDING→CONFIRMED), usar (CONFIRMED→USED) ou cancelar (PENDING/CONFIRMED→CANCELLED,
 * devolvendo os pontos). Repetir a mesma ação é inofensivo.
 */
export async function changeRedemption(
  deps: RewardDeps,
  id: string,
  action: RedemptionAction,
  opts: { stayId?: string } = {},
): Promise<RedemptionRow> {
  const guestId = await deps.repo.findRedemptionGuest(id);
  if (!guestId) throw new RedemptionNotFoundError();

  return deps.repo.inGuestTransaction(guestId, async (uow) => {
    const now = (deps.now ?? (() => new Date()))();
    const r = await uow.getRedemption(id); // relido sob a trava
    if (!r) throw new RedemptionNotFoundError();

    if (action === 'confirm') {
      if (r.status === 'CONFIRMED') return r;
      if (r.status !== 'PENDING') throw new InvalidTransitionError();
      await uow.setStatus(id, 'CONFIRMED');
      return { ...r, status: 'CONFIRMED' };
    }
    if (action === 'use') {
      if (r.status === 'USED') return r;
      if (r.status !== 'CONFIRMED') throw new InvalidTransitionError();
      if (opts.stayId && !(await uow.stayBelongsToGuest(opts.stayId, r.guestId))) throw new InvalidStayError();
      await uow.setStatus(id, 'USED', { stayId: opts.stayId, usedAt: now });
      return { ...r, status: 'USED', stayId: opts.stayId ?? null };
    }
    if (r.status === 'CANCELLED') return r;
    if (r.status === 'USED') throw new InvalidTransitionError();
    await uow.cancelRedemption(r, now);
    return { ...r, status: 'CANCELLED' };
  });
}

export async function getBalance(deps: RewardDeps, guestId: string) {
  const now = (deps.now ?? (() => new Date()))();
  const b = await deps.repo.getBalance(guestId, now);
  if (!b) throw new GuestNotFoundError();
  return b;
}

export const getStatement = (deps: RewardDeps, guestId: string, limit: number) =>
  deps.repo.getStatement(guestId, limit);
