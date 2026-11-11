import { loyaltyConfig, type LoyaltyConfig } from '../config/loyalty';
import { addMonths, planExpirations, planNotices, planTierReview } from '../domain/points/maintenance';
import type { MaintenanceRepository } from './ports';

export interface MaintenanceDeps {
  repo: MaintenanceRepository;
  config?: LoyaltyConfig;
  now?: () => Date;
}

export interface MaintenanceResult {
  expiredLots: number;
  expiredPoints: number;
  noticesCreated: number;
  tierReviews: number;
  tierDowngrades: number;
  errors: number;
}

/**
 * Rotina diária. Segura para rodar mais de uma vez no mesmo dia: cada passo é idempotente
 * (lote só expira uma vez, aviso tem chave única, revisão só atua em nível com validade vencida).
 * Falha em um hóspede não interrompe os demais.
 */
export async function runNightly(deps: MaintenanceDeps): Promise<MaintenanceResult> {
  const cfg = deps.config ?? loyaltyConfig;
  const now = (deps.now ?? (() => new Date()))();
  const { repo } = deps;
  const result: MaintenanceResult = {
    expiredLots: 0,
    expiredPoints: 0,
    noticesCreated: 0,
    tierReviews: 0,
    tierDowngrades: 0,
    errors: 0,
  };

  // 1) Vencimento de pontos
  const lots = await repo.loadActiveLots();
  for (const item of planExpirations(lots, now)) {
    try {
      if (await repo.expireLot(item)) {
        result.expiredLots++;
        result.expiredPoints += item.points;
      }
    } catch {
      result.errors++;
    }
  }

  // 2) Avisos de vencimento (só sobre o que ainda não venceu)
  const stillActive = lots.filter((l) => l.expiresAt > now);
  try {
    result.noticesCreated = await repo.saveNotices(planNotices(stillActive, now, cfg.expiryWarningDays));
  } catch {
    result.errors++;
  }

  // 3) Revisão de nível com validade vencida
  for (const c of await repo.findTierReviewCandidates(now)) {
    try {
      const qualifying = await repo.qualifyingPointsSince(c.guestId, addMonths(now, -cfg.tierWindowMonths));
      const plan = planTierReview(qualifying, now, cfg);
      if (await repo.applyTierReview(c.guestId, plan.newRank, plan.validUntil, now)) {
        result.tierReviews++;
        if (plan.newRank < c.tierRank) result.tierDowngrades++;
      }
    } catch {
      result.errors++;
    }
  }
  return result;
}
