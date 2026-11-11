// Parâmetros do programa. Ver docs/decisions/0003-regras-de-pontos.md
export type ChargeCategory = 'ROOM' | 'FNB' | 'SPA' | 'EVENTS' | 'OTHER';

export interface TierConfig {
  name: string;
  rank: number;
  minQualifyingPts: number;
  multiplier: number;
}

export const loyaltyConfig = {
  earnRatePerCurrency: { ROOM: 1, FNB: 1, SPA: 1, EVENTS: 0.5, OTHER: 0 } as Record<ChargeCategory, number>,
  directBookingBonusRate: 0.2,
  birthdayBonusPoints: 500,
  referral: { refereeWelcomePoints: 500, referrerPoints: 1000 },
  expirationMonths: 24,
  expiryWarningDays: [90, 30],
  tierWindowMonths: 12,
  tiers: [
    { name: 'Bronze', rank: 0, minQualifyingPts: 0, multiplier: 1.0 },
    { name: 'Prata', rank: 1, minQualifyingPts: 3000, multiplier: 1.25 },
    { name: 'Ouro', rank: 2, minQualifyingPts: 8000, multiplier: 1.5 },
    { name: 'Diamante', rank: 3, minQualifyingPts: 20000, multiplier: 2.0 },
  ] as TierConfig[],
};
export type LoyaltyConfig = typeof loyaltyConfig;
