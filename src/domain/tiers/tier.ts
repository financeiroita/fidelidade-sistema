import { LoyaltyConfig, TierConfig } from '../../config/loyalty';

/** Maior nível cujo mínimo é atingido pelos pontos qualificáveis dos últimos 12 meses. */
export function resolveTier(qualifyingPts12m: number, cfg: LoyaltyConfig): TierConfig {
  return (
    [...cfg.tiers]
      .sort((a, b) => b.minQualifyingPts - a.minQualifyingPts)
      .find((t) => qualifyingPts12m >= t.minQualifyingPts) ?? cfg.tiers[0]
  );
}

/**
 * Nível que vale AGORA. Se a validade do nível guardado acabou e a rotina noturna ainda não
 * revisou, vale o que os pontos-base da janela garantem. É a única regra para check-out,
 * resgate e "Minha conta" (ADR 0016).
 */
export function effectiveTierRank(
  storedRank: number,
  validUntil: Date | null,
  qualifyingPts: number,
  now: Date,
  cfg: LoyaltyConfig,
): number {
  const expired = storedRank > 0 && (!validUntil || validUntil <= now);
  return expired ? resolveTier(qualifyingPts, cfg).rank : storedRank;
}
