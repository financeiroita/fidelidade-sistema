import { randomUUID } from 'node:crypto';
import { loyaltyConfig, type LoyaltyConfig } from '../config/loyalty';
import { calculateStayPoints, totalPoints } from '../domain/points/earn';
import { expirationDate } from '../domain/points/expiry';
import { isDirectChannel, nightsBetween, type StayInput } from '../domain/stays/stay';
import { addDays, addMonths, localDate } from '../domain/time';
import { resolveTier } from '../domain/tiers/tier';
import {
  StayAlreadyProcessedError,
  StayNotEligibleError,
  StayNotFoundError,
  StayOutOfPeriodError,
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


/**
 * Registra uma estadia lançada manualmente (recepção). Ainda não gera pontos.
 * Recusa estadia antiga demais (mais de `manualStayMaxDaysBack` dias depois do check-out) e estadia
 * que terminou antes do cadastro do hóspede (ADR 0004: estadias anteriores ao cadastro não pontuam).
 */
export async function registerStay(deps: LoyaltyDeps, input: StayInput): Promise<{ id: string; nights: number }> {
  const cfg = deps.config ?? loyaltyConfig;
  const now = (deps.now ?? (() => new Date()))();
  const today = localDate(now, cfg.timeZone);
  if (input.checkOut < addDays(today, -cfg.manualStayMaxDaysBack)) {
    throw new StayOutOfPeriodError(`Só é possível lançar estadias com check-out nos últimos ${cfg.manualStayMaxDaysBack} dias.`);
  }
  // Datas da estadia já são do calendário do hotel; a data de cadastro é convertida para o fuso do hotel.
  const allowed = (memberSince: Date) => input.checkOut >= localDate(memberSince, cfg.timeZone);
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
    externalRef: input.externalRef,
    charges: input.charges,
  }, allowed);
  return { id, nights };
}

/**
 * Regra pura: o que creditar no check-out. Sem acesso a banco.
 * - Pontos pelo nível vigente do hóspede no momento do check-out.
 * - No 1º check-out com receita: libera as boas-vindas pendentes e paga o indicador.
 * - Nível sobe se os pontos qualificáveis em 12 meses atingirem o limiar; se for mantido,
 *   a validade é renovada (descer é tarefa noturna).
 */
export function planCheckout(
  data: CheckoutData,
  qualifyingBefore: number,
  now: Date,
  cfg: LoyaltyConfig,
): { commit: CheckoutCommit; earned: number; tier: string; upgraded: boolean } {
  const { stay, guest } = data;
  const storedTier = cfg.tiers.find((t) => t.rank === guest.tierRank) ?? cfg.tiers[0];
  // Nível com validade vencida (a rotina noturna ainda não rebaixou, ou falhou): vale o que o
  // hóspede realmente atinge pelos pontos-base dos últimos 12 meses, e não o nível guardado.
  const expired = storedTier.rank > 0 && (!guest.tierValidUntil || guest.tierValidUntil <= now);
  const tier = expired ? resolveTier(qualifyingBefore, cfg) : storedTier;
  const lines = calculateStayPoints({ charges: data.charges, isDirect: stay.isDirect }, tier, cfg);
  const expiresAt = expirationDate(now, cfg);

  const transactions: NewPointsTx[] = lines.map((l) => ({
    guestId: guest.id,
    type: l.kind === 'ROOM' ? 'EARN_STAY' : l.kind === 'CHARGE' ? 'EARN_CHARGE' : 'EARN_BONUS',
    points: l.points,
    qualifyingPts: l.qualifyingPts,
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
        qualifyingPts: 0,
        expiresAt,
        stayId: stay.id,
        idempotencyKey: `welcome:${guest.id}`,
        note: 'Boas-vindas por indicação',
      });
      clearWelcomePending = true;
    }
    if (guest.referredById && guest.referrerActive) {
      transactions.push({
        guestId: guest.referredById,
        type: 'EARN_BONUS',
        points: cfg.referral.referrerPoints,
        qualifyingPts: 0,
        expiresAt,
        idempotencyKey: `referral:${guest.id}`,
        note: 'Indicação: 1º check-out do indicado',
      });
    }
  }

  // Prévia (para a resposta); a decisão que vale é tomada pelo repositório sob a trava do hóspede,
  // com os pontos-base relidos (outro check-out simultâneo pode ter acabado de somar pontos).
  const qualifyingNow = qualifyingBefore + lines.reduce((s, l) => s + l.qualifyingPts, 0);
  const reached = resolveTier(qualifyingNow, cfg);
  const upgraded = reached.rank > storedTier.rank;

  return {
    commit: {
      stayId: stay.id,
      guestId: guest.id,
      transactions,
      tierWindowStart: addMonths(now, -cfg.tierWindowMonths),
      decideTier: (qualifyingPts, currentRank) => decideTier(qualifyingPts, currentRank, now, cfg),
      clearWelcomePending,
      processedAt: now,
    },
    earned,
    tier: (upgraded ? reached : tier).name,
    // Observação: se o nível guardado está vencido e o hóspede não o mantém, quem rebaixa é a rotina noturna.
    upgraded,
  };
}

/**
 * Nível depois do crédito: sobe se os pontos-base dos últimos 12 meses atingirem um nível acima;
 * se mantiver o nível atual (acima do inicial), a validade é renovada. Descer é tarefa da rotina noturna.
 */
export function decideTier(
  qualifyingPts: number,
  currentRank: number,
  now: Date,
  cfg: LoyaltyConfig,
): { newTierRank?: number; tierValidUntil?: Date } {
  const reached = resolveTier(qualifyingPts, cfg);
  const validUntil = addMonths(now, cfg.tierWindowMonths);
  if (reached.rank > currentRank) return { newTierRank: reached.rank, tierValidUntil: validUntil };
  const current = cfg.tiers.find((t) => t.rank === currentRank);
  if (current && current.rank > 0 && qualifyingPts >= current.minQualifyingPts) return { tierValidUntil: validUntil };
  return {};
}

export interface CheckoutResult {
  stayId: string;
  alreadyProcessed: boolean;
  earned: number;
  tier: string;
  upgraded: boolean;
}

const MAX_ATTEMPTS = 3;

/**
 * Processa o check-out: credita pontos uma única vez por estadia (idempotente).
 * Se outro processamento concorrente do mesmo hóspede mudar o cenário (ex.: o bônus de
 * indicação já foi pago por outra estadia), recarrega os dados e recalcula.
 */
export async function processCheckout(deps: LoyaltyDeps, stayId: string): Promise<CheckoutResult> {
  const cfg = deps.config ?? loyaltyConfig;
  const now = (deps.now ?? (() => new Date()))();

  for (let attempt = 1; ; attempt++) {
    const data = await deps.stays.loadCheckout(stayId);
    if (!data) throw new StayNotFoundError();

    const tierName = (cfg.tiers.find((t) => t.rank === data.guest.tierRank) ?? cfg.tiers[0]).name;
    if (data.stay.pointsProcessedAt) {
      return { stayId, alreadyProcessed: true, earned: 0, tier: tierName, upgraded: false };
    }
    if (!data.guest.active) throw new StayNotEligibleError('Hóspede excluído do programa.');
    if (data.stay.status === 'CANCELLED' || data.stay.status === 'NO_SHOW') {
      throw new StayNotEligibleError('Estadia cancelada ou no-show não gera pontos.');
    }
    // A data de saída é do calendário do hotel; compara com o "hoje" no fuso do hotel (sem folga).
    if (data.stay.checkOut.toISOString().slice(0, 10) > localDate(now, cfg.timeZone)) {
      throw new StayNotEligibleError('O check-out ainda não aconteceu.');
    }

    const qualifyingBefore = await deps.stays.qualifyingPointsSince(
      data.guest.id,
      addMonths(now, -cfg.tierWindowMonths),
    );
    const plan = planCheckout(data, qualifyingBefore, now, cfg);
    try {
      const { tierRank, tierValidUntil } = await deps.stays.commitCheckout(plan.commit);
      const upgraded = tierRank > data.guest.tierRank;
      // Nível final gravado; se continua vencido (não foi renovado), vale o que o hóspede atinge (prévia).
      const stillExpired = tierRank > 0 && (!tierValidUntil || tierValidUntil <= now);
      const tier = stillExpired ? plan.tier : (cfg.tiers.find((t) => t.rank === tierRank) ?? cfg.tiers[0]).name;
      return { stayId, alreadyProcessed: false, earned: plan.earned, tier, upgraded };
    } catch (e) {
      // Conflito: ou esta estadia já foi processada (o próximo ciclo detecta e responde) ou os
      // dados do hóspede mudaram no meio (o próximo ciclo recalcula com os dados novos).
      if (!(e instanceof StayAlreadyProcessedError) || attempt >= MAX_ATTEMPTS) throw e;
    }
  }
}
