import type { LoyaltyConfig } from '../../config/loyalty';
import { resolveTier } from '../tiers/tier';

/** Lote de pontos creditado, ainda com saldo. */
export interface LotRow {
  id: string;
  guestId: string;
  remaining: number;
  expiresAt: Date;
}

export interface ExpirationPlan {
  lotId: string;
  guestId: string;
  points: number;
}

export interface NoticePlan {
  guestId: string;
  windowDays: number;
  points: number;
  /** Data do primeiro vencimento dentro da janela (chave de idempotência do aviso). */
  expiresOn: Date;
}

const DAY = 86_400_000;
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export const addMonths = (d: Date, months: number) => {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
};

/** Lotes vencidos com saldo: cada um vira um lançamento de expiração. */
export function planExpirations(lots: LotRow[], now: Date): ExpirationPlan[] {
  return lots
    .filter((l) => l.remaining > 0 && l.expiresAt <= now)
    .map((l) => ({ lotId: l.id, guestId: l.guestId, points: l.remaining }));
}

/**
 * Um aviso por hóspede, na menor janela (ex.: 30 antes de 90) em que há pontos a vencer.
 * A chave (hóspede, janela, data do 1º vencimento) faz a rotina diária não repetir o aviso.
 */
export function planNotices(lots: LotRow[], now: Date, windows: number[]): NoticePlan[] {
  const sorted = [...windows].sort((a, b) => a - b);
  const byGuest = new Map<string, LotRow[]>();
  for (const l of lots) {
    if (l.remaining <= 0 || l.expiresAt <= now) continue;
    byGuest.set(l.guestId, [...(byGuest.get(l.guestId) ?? []), l]);
  }
  const plans: NoticePlan[] = [];
  for (const [guestId, list] of byGuest) {
    const earliest = list.reduce((m, l) => (l.expiresAt < m ? l.expiresAt : m), list[0].expiresAt);
    const windowDays = sorted.find((w) => earliest.getTime() <= now.getTime() + w * DAY);
    if (windowDays === undefined) continue;
    const limit = now.getTime() + windowDays * DAY;
    const points = list.filter((l) => l.expiresAt.getTime() <= limit).reduce((s, l) => s + l.remaining, 0);
    plans.push({ guestId, windowDays, points, expiresOn: utcDay(earliest) });
  }
  return plans;
}

/**
 * Revisão de nível quando a validade acabou: recalcula pelos pontos-base dos últimos 12 meses.
 * Quem não chegou ao nível atual desce; quem mantém ou sobe ganha nova validade de 12 meses.
 */
export function planTierReview(qualifyingPts12m: number, now: Date, cfg: LoyaltyConfig) {
  const reached = resolveTier(qualifyingPts12m, cfg);
  return {
    newRank: reached.rank,
    validUntil: reached.rank > 0 ? addMonths(now, cfg.tierWindowMonths) : null,
  };
}
