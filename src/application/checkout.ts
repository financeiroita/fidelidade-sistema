import { randomUUID } from 'node:crypto';
import { loyaltyConfig, type LoyaltyConfig } from '../config/loyalty';
import { calculateStayPoints, totalPoints } from '../domain/points/earn';
import { expirationDate } from '../domain/points/expiry';
import { isDirectChannel, nightsBetween, type StayInput } from '../domain/stays/stay';
import { resolveTier } from '../domain/tiers/tier';
import {
  GuestNotFoundError,
  StayAlreadyProcessedError,
  StayNotEligibleError,
  StayNotFoundError,
  type CheckoutCommit,
  type CheckoutData,
  type NewPointsTx,
  type StayRepository,
} from './ports';

export interface LoyaltyDeps {
  stays: StayRepository;
  config?: LoyaltyConfig;
  now?: () => Date;
}

const addMonths = (d: Date, months: number) => {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
};

/** Registra uma estadia lançada manualmente (recepção). Ainda não gera pontos. */
export async function registerStay(deps: LoyaltyDeps, input: StayInput): Promise<{ id: string; nights: number }> {
  const id = randomUUID();
  const nights = nightsBetween(input.checkIn, input.checkOut);
  await deps.stays.createStay({
    id,
    guestId: input.guestId,
    channel: input.channel,
    isDirect: isDirectChannel(input.channel),
    checkIn: new Date(`${input.checkIn}T00:00:00Z`),
    checkOut: new Date(`${input.checkOut}T00:00:00Z`),
    nights,
    roomType: input.roomType,
    adults: input.adults,
    children: input.children,
    charges: input.charges,
  });
  return { id, nights };
}

/**
 * Regra pura: o que creditar no check-out. Sem acesso a banco.
 * - Pontos pelo nível vigente do hóspede no momento do check-out.
 * - No 1º check-out com receita: libera as boas-vindas pendentes e paga o indicador.
 * - Nível sobe se os pontos qualificáveis em 12 meses atingirem o limiar (descer é tarefa noturna).
 */
export function planCheckout(
  data: CheckoutData,
  qualifyingBefore: number,
  now: Date,
  cfg: LoyaltyConfig,
): { commit: CheckoutCommit; earned: number; tier: string; upgraded: boolean } {
  const { stay, guest } = data;
  const tier = cfg.tiers.find((t) => t.rank === guest.tierRank) ?? cfg.tiers[0];
  const lines = calculateStayPoints({ charges: data.charges, isDirect: stay.isDirect }, tier, cfg);
  const expiresAt = expirationDate(now, cfg);

  const transactions: NewPointsTx[] = lines.map((l) => ({
    guestId: guest.id,
    type: l.kind === 'ROOM' ? 'EARN_STAY' : l.kind === 'CHARGE' ? 'EARN_CHARGE' : 'EARN_BONUS',
    points: l.points,
    qualifying: l.qualifying,
    expiresAt,
    stayId: stay.id,
    idempotencyKey: `stay:${stay.id}:${l.kind}${l.category ? `:${l.category}` : ''}`,
    note: l.kind === 'DIRECT_BONUS' ? 'Bônus de reserva direta' : undefined,
  }));
  const earned = totalPoints(lines);

  let clearWelcomePending = false;
  if (earned > 0 && !data.hasPriorEarning) {
    if (guest.welcomeBonusPending > 0) {
      transactions.push({
        guestId: guest.id,
        type: 'EARN_BONUS',
        points: guest.welcomeBonusPending,
        qualifying: false,
        expiresAt,
        stayId: stay.id,
        idempotencyKey: `welcome:${guest.id}`,
        note: 'Boas-vindas por indicação',
      });
      clearWelcomePending = true;
    }
    if (guest.referredById) {
      transactions.push({
        guestId: guest.referredById,
        type: 'EARN_BONUS',
        points: cfg.referral.referrerPoints,
        qualifying: false,
        expiresAt,
        idempotencyKey: `referral:${guest.id}`,
        note: 'Indicação: 1º check-out do indicado',
      });
    }
  }

  const qualifyingNow = qualifyingBefore + lines.filter((l) => l.qualifying).reduce((s, l) => s + l.points, 0);
  const reached = resolveTier(qualifyingNow, cfg);
  const upgraded = reached.rank > tier.rank;

  return {
    commit: {
      stayId: stay.id,
      guestId: guest.id,
      transactions,
      newTierRank: upgraded ? reached.rank : undefined,
      tierValidUntil: upgraded ? addMonths(now, cfg.tierWindowMonths) : undefined,
      clearWelcomePending,
      processedAt: now,
    },
    earned,
    tier: (upgraded ? reached : tier).name,
    upgraded,
  };
}

export interface CheckoutResult {
  stayId: string;
  alreadyProcessed: boolean;
  earned: number;
  tier: string;
  upgraded: boolean;
}

/** Processa o check-out: credita pontos uma única vez por estadia (idempotente). */
export async function processCheckout(deps: LoyaltyDeps, stayId: string): Promise<CheckoutResult> {
  const cfg = deps.config ?? loyaltyConfig;
  const now = (deps.now ?? (() => new Date()))();
  const data = await deps.stays.loadCheckout(stayId);
  if (!data) throw new StayNotFoundError();

  const tierName = (cfg.tiers.find((t) => t.rank === data.guest.tierRank) ?? cfg.tiers[0]).name;
  if (data.stay.pointsProcessedAt) {
    return { stayId, alreadyProcessed: true, earned: 0, tier: tierName, upgraded: false };
  }
  if (data.stay.status === 'CANCELLED' || data.stay.status === 'NO_SHOW') {
    throw new StayNotEligibleError('Estadia cancelada ou no-show não gera pontos.');
  }

  const qualifyingBefore = await deps.stays.qualifyingPointsSince(data.guest.id, addMonths(now, -cfg.tierWindowMonths));
  const plan = planCheckout(data, qualifyingBefore, now, cfg);
  try {
    await deps.stays.commitCheckout(plan.commit);
  } catch (e) {
    if (e instanceof StayAlreadyProcessedError) {
      return { stayId, alreadyProcessed: true, earned: 0, tier: tierName, upgraded: false };
    }
    throw e;
  }
  return { stayId, alreadyProcessed: false, earned: plan.earned, tier: plan.tier, upgraded: plan.upgraded };
}

export { GuestNotFoundError };
