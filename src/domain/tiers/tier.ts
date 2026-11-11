import { LoyaltyConfig, TierConfig } from '../../config/loyalty';

/** Maior nível cujo mínimo é atingido pelos pontos qualificáveis dos últimos 12 meses. */
export function resolveTier(qualifyingPts12m: number, cfg: LoyaltyConfig): TierConfig {
  return (
    [...cfg.tiers]
      .sort((a, b) => b.minQualifyingPts - a.minQualifyingPts)
      .find((t) => qualifyingPts12m >= t.minQualifyingPts) ?? cfg.tiers[0]
  );
}
