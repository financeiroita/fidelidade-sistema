import { loyaltyConfig, type LoyaltyConfig } from '../config/loyalty';
import { planExpirations, planNotices, planTierReview } from '../domain/points/maintenance';
import { addMonths } from '../domain/time';
import type { MaintenanceRepository } from './ports';

/** Evento de erro sem dados pessoais: só a etapa, o id (UUID) e o código do erro. */
export type MaintenanceLogger = (event: { step: string; id?: string; code: string }) => void;

export interface MaintenanceDeps {
  repo: MaintenanceRepository;
  config?: LoyaltyConfig;
  now?: () => Date;
  logger?: MaintenanceLogger;
}

export interface MaintenanceResult {
  expiredLots: number;
  expiredPoints: number;
  noticesCreated: number;
  tierReviews: number;
  tierDowngrades: number;
  sessionsPurged: number;
  errors: number;
}

const errorCode = (e: unknown) => {
  const x = e as { code?: string; name?: string };
  return x?.code ?? x?.name ?? 'erro';
};

/**
 * Rotina diária. Segura para rodar mais de uma vez no mesmo dia: cada passo é idempotente
 * (lote só expira uma vez, aviso tem chave única, revisão só atua em nível com validade vencida).
 * Cada passo é isolado: falha em um item ou em uma etapa não impede as demais.
 */
export async function runNightly(deps: MaintenanceDeps): Promise<MaintenanceResult> {
  const cfg = deps.config ?? loyaltyConfig;
  const now = (deps.now ?? (() => new Date()))();
  const { repo } = deps;
  const log: MaintenanceLogger = deps.logger ?? (() => undefined);
  const result: MaintenanceResult = {
    expiredLots: 0,
    expiredPoints: 0,
    noticesCreated: 0,
    tierReviews: 0,
    tierDowngrades: 0,
    sessionsPurged: 0,
    errors: 0,
  };
  const fail = (step: string, e: unknown, id?: string) => {
    result.errors++;
    log({ step, id, code: errorCode(e) });
  };

  // 1) Vencimento de pontos e 2) avisos (compartilham a leitura dos lotes)
  let lots: Awaited<ReturnType<typeof repo.loadActiveLots>> = [];
  try {
    // Só os lotes que vencem até o fim da maior janela de aviso: os demais não interessam hoje.
    const horizonDays = Math.max(0, ...cfg.expiryWarningDays);
    lots = await repo.loadActiveLots(new Date(now.getTime() + horizonDays * 86_400_000));
  } catch (e) {
    fail('carregar-lotes', e);
  }

  for (const item of planExpirations(lots, now)) {
    try {
      if (await repo.expireLot(item, now)) {
        result.expiredLots++;
        result.expiredPoints += item.points;
      }
    } catch (e) {
      fail('expirar-lote', e, item.lotId);
    }
  }

  try {
    const stillActive = lots.filter((l) => l.expiresAt > now);
    result.noticesCreated = await repo.saveNotices(planNotices(stillActive, now, cfg.expiryWarningDays, cfg.timeZone));
  } catch (e) {
    fail('avisos', e);
  }

  // Sessões de login vencidas
  try {
    result.sessionsPurged = await repo.purgeExpiredSessions(now);
  } catch (e) {
    fail('limpar-sessoes', e);
  }

  // 3) Revisão de nível com validade vencida
  try {
    const since = addMonths(now, -cfg.tierWindowMonths);
    for (const c of await repo.findTierReviewCandidates(now)) {
      try {
        const r = await repo.reviewTier(c.guestId, now, since, (q) => planTierReview(q, now, cfg));
        if (r) {
          result.tierReviews++;
          if (r.newRank < r.previousRank) result.tierDowngrades++;
        }
      } catch (e) {
        fail('revisar-nivel', e, c.guestId);
      }
    }
  } catch (e) {
    fail('candidatos-nivel', e);
  }
  return result;
}
