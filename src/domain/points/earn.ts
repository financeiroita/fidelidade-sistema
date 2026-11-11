import { ChargeCategory, LoyaltyConfig, TierConfig } from '../../config/loyalty';

export interface ChargeInput {
  category: ChargeCategory;
  amount: number; // líquido; negativo = estorno
}
export interface StayEarnInput {
  charges: ChargeInput[];
  isDirect: boolean;
}
export interface EarnLine {
  kind: 'ROOM' | 'CHARGE' | 'DIRECT_BONUS';
  category?: ChargeCategory;
  points: number;
  qualifying: boolean;
}

/** Pontos de uma estadia concluída. Arredonda para baixo por linha. */
export function calculateStayPoints(input: StayEarnInput, tier: TierConfig, cfg: LoyaltyConfig): EarnLine[] {
  const lines: EarnLine[] = [];
  const byCat = new Map<ChargeCategory, number>();
  for (const c of input.charges) byCat.set(c.category, (byCat.get(c.category) ?? 0) + c.amount);

  let roomBase = 0;
  for (const [category, total] of byCat) {
    const base = Math.floor(Math.max(0, total) * cfg.earnRatePerCurrency[category]);
    const points = Math.floor(base * tier.multiplier);
    if (category === 'ROOM') roomBase = base;
    if (points > 0) lines.push({ kind: category === 'ROOM' ? 'ROOM' : 'CHARGE', category, points, qualifying: true });
  }
  if (input.isDirect && roomBase > 0) {
    const bonus = Math.floor(roomBase * cfg.directBookingBonusRate);
    if (bonus > 0) lines.push({ kind: 'DIRECT_BONUS', points: bonus, qualifying: false });
  }
  return lines;
}

export const totalPoints = (lines: EarnLine[]) => lines.reduce((s, l) => s + l.points, 0);
