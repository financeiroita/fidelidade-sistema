import { LoyaltyConfig } from '../../config/loyalty';

export interface Lot {
  id: string;
  remaining: number;
  expiresAt: Date;
}
export interface Consumption {
  lotId: string;
  points: number;
}

export function expirationDate(creditedAt: Date, cfg: LoyaltyConfig): Date {
  const d = new Date(creditedAt);
  d.setUTCMonth(d.getUTCMonth() + cfg.expirationMonths);
  return d;
}

/** Consome pontos FIFO pelo vencimento mais próximo. Lança erro se saldo insuficiente. */
export function consumeFifo(lots: Lot[], points: number, now: Date): Consumption[] {
  const usable = lots
    .filter((l) => l.remaining > 0 && l.expiresAt > now)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const available = usable.reduce((s, l) => s + l.remaining, 0);
  if (points > available) throw new Error(`Saldo insuficiente: ${available} < ${points}`);
  const out: Consumption[] = [];
  let left = points;
  for (const lot of usable) {
    if (left === 0) break;
    const take = Math.min(lot.remaining, left);
    out.push({ lotId: lot.id, points: take });
    left -= take;
  }
  return out;
}

/** Lotes vencidos que devem gerar transação EXPIRE. */
export function findExpired(lots: Lot[], now: Date): Consumption[] {
  return lots.filter((l) => l.remaining > 0 && l.expiresAt <= now).map((l) => ({ lotId: l.id, points: l.remaining }));
}

/** Pontos que vencem dentro de `days` dias (avisos de marketing). */
export function expiringWithin(lots: Lot[], now: Date, days: number): number {
  const limit = new Date(now.getTime() + days * 86_400_000);
  return lots
    .filter((l) => l.remaining > 0 && l.expiresAt > now && l.expiresAt <= limit)
    .reduce((s, l) => s + l.remaining, 0);
}
