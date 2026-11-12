import { LoyaltyConfig } from '../../config/loyalty';
import { endOfHotelDayAfterMonths, lastValidDay as lastDay } from '../time';

export interface Lot {
  id: string;
  remaining: number;
  expiresAt: Date;
}
export interface Consumption {
  lotId: string;
  points: number;
}

/**
 * Os pontos valem até o FIM do dia do hotel em que completam a validade (ADR 0016): o vencimento
 * é o início do dia seguinte no fuso do hotel. Assim "vencem em 12/11" significa "use até 12/11".
 */
export function expirationDate(creditedAt: Date, cfg: LoyaltyConfig): Date {
  // Meses somados na data do hotel: créditos do mesmo dia do hotel vencem no mesmo dia.
  return endOfHotelDayAfterMonths(creditedAt, cfg.expirationMonths, cfg.timeZone);
}

/** Último dia (AAAA-MM-DD, no fuso do hotel) em que o lote ainda pode ser usado: o que o hóspede lê. */
export function lastValidDay(expiresAt: Date, timeZone: string): string {
  return lastDay(expiresAt, timeZone);
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
