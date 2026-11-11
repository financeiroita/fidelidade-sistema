import { ChargeCategory, LoyaltyConfig, TierConfig } from '../../config/loyalty';

export interface ChargeInput {
  category: ChargeCategory;
  amount: number; // líquido, em reais com no máximo 2 casas; negativo = estorno
}
export interface StayEarnInput {
  charges: ChargeInput[];
  isDirect: boolean;
}
export interface EarnLine {
  kind: 'ROOM' | 'CHARGE' | 'DIRECT_BONUS';
  category?: ChargeCategory;
  points: number;
  /** Pontos que contam para o nível: valor base, sem o multiplicador do nível (ADR 0003). */
  qualifyingPts: number;
}

/** Arredonda para baixo tolerando o erro de ponto flutuante (ex.: 2.9999999999999996 vira 3). */
const floorSafe = (x: number) => Math.floor(x + 1e-9);

/** Pontos de uma estadia concluída. Soma em centavos inteiros; arredonda para baixo por linha. */
export function calculateStayPoints(input: StayEarnInput, tier: TierConfig, cfg: LoyaltyConfig): EarnLine[] {
  const lines: EarnLine[] = [];
  const centsByCat = new Map<ChargeCategory, number>();
  for (const c of input.charges) {
    centsByCat.set(c.category, (centsByCat.get(c.category) ?? 0) + Math.round(c.amount * 100));
  }

  let roomBase = 0;
  for (const [category, cents] of centsByCat) {
    const base = floorSafe((Math.max(0, cents) * cfg.earnRatePerCurrency[category]) / 100);
    const points = floorSafe(base * tier.multiplier);
    if (category === 'ROOM') roomBase = base;
    if (points > 0) {
      lines.push({ kind: category === 'ROOM' ? 'ROOM' : 'CHARGE', category, points, qualifyingPts: base });
    }
  }
  if (input.isDirect && roomBase > 0) {
    const bonus = floorSafe(roomBase * cfg.directBookingBonusRate);
    if (bonus > 0) lines.push({ kind: 'DIRECT_BONUS', points: bonus, qualifyingPts: 0 });
  }
  return lines;
}

export const totalPoints = (lines: EarnLine[]) => lines.reduce((s, l) => s + l.points, 0);
